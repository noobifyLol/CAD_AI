/**
 * deepcadCompiler.js — DeepCAD-style sketch + extrude sequences → FeatureScript 2931.
 *
 * Models trained on the DeepCAD dataset (DeepCAD, Text2CAD, and models that emit
 * Text2CAD's "minimal JSON") describe a part as an ordered list of steps. Each step
 * is a planar sketch (faces made of line / arc / circle loops) on a coordinate
 * system, extruded towards and/or away from the sketch normal, then combined with
 * the part so far (new body, join, cut, intersect).
 *
 * That representation is exact geometry, so instead of asking an LLM to write
 * FeatureScript we compile it deterministically: the emitted code is always
 * syntactically valid, and the shape is exactly what the model predicted.
 *
 * Accepted inputs (detectCadSequenceFormat):
 *   - "cad-sequence/v1"  — this project's neutral format (returned by hf_space/)
 *   - DeepCAD JSON       — the dataset's cad_json files ({ entities, sequence })
 *   - Text2CAD minimal JSON ({ parts: { part_1: { coordinate_system, sketch, extrusion } } })
 *
 * Semantics follow Text2CAD's CadSeqProc (cad_sequence.py, coord_system.py,
 * sketchsequence.py, arc.py) so a sequence builds the same solid it builds there:
 *   3D point = origin + u * xAxis + v * yAxis
 *   solid    = prism of the sketch faces from -oppositeNormal to +towardsNormal
 *   new/join → union, cut → subtract, intersect → common.
 *
 * cad-sequence/v1:
 * {
 *   "format": "cad-sequence/v1",
 *   "units": "normalized" | "m" | "cm" | "mm" | "inch",
 *   "steps": [{
 *     "plane": { "origin": [x,y,z], "xAxis": [x,y,z], "normal": [x,y,z] },
 *     "faces": [ { "loops": [ [ {"type":"line","start":[u,v],"end":[u,v]},
 *                               {"type":"arc","start":[u,v],"mid":[u,v],"end":[u,v]},
 *                               {"type":"circle","center":[u,v],"radius":r} ] ] } ],
 *     "extrude": { "towardsNormal": d1, "oppositeNormal": d2,
 *                  "operation": "new" | "join" | "cut" | "intersect" }
 *   }]
 * }
 */

const OPERATIONS = ["new", "join", "cut", "intersect"];
const DEEPCAD_OPERATION_NAMES = {
  NewBodyFeatureOperation: "new",
  JoinFeatureOperation: "join",
  CutFeatureOperation: "cut",
  IntersectFeatureOperation: "intersect",
};
const UNIT_TO_INCH = { inch: 1, in: 1, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 };
const DEFAULT_NORMALIZED_SIZE_INCH = 2;
const EPS = 1e-9;

// ─── small vector helpers ───────────────────────────────────────────────────

const sub = (a, b) => a.map((value, i) => value - b[i]);
const add = (a, b) => a.map((value, i) => value + b[i]);
const scale = (a, k) => a.map(value => value * k);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = a => Math.sqrt(dot(a, a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => {
  const length = norm(a);
  return length < EPS ? null : scale(a, 1 / length);
};

function isFiniteVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(component => Number.isFinite(Number(component)));
}

function toNumbers(value) {
  return value.map(Number);
}

function xyz(point) {
  return [Number(point?.x), Number(point?.y), Number(point?.z ?? 0)];
}

// ─── format detection + importers ───────────────────────────────────────────

export function detectCadSequenceFormat(input) {
  if (!input || typeof input !== "object") return null;
  if (input.format === "cad-sequence/v1" || Array.isArray(input.steps)) return "cad-sequence/v1";
  if (input.entities && Array.isArray(input.sequence)) return "deepcad-json";
  if (input.parts && typeof input.parts === "object") return "text2cad-minimal-json";
  return null;
}

/** Convert any supported input into cad-sequence/v1 (throws on unknown formats). */
export function toCadSequence(input) {
  const format = detectCadSequenceFormat(input);
  if (format === "cad-sequence/v1") return { format: "cad-sequence/v1", units: input.units || "normalized", ...input };
  if (format === "deepcad-json") return deepcadJsonToCadSequence(input);
  if (format === "text2cad-minimal-json") return text2cadMinimalJsonToCadSequence(input);
  throw new Error("Unrecognised CAD sequence: expected cad-sequence/v1, DeepCAD JSON ({entities, sequence}) or Text2CAD minimal JSON ({parts}).");
}

function deepcadCurve(curve) {
  if (curve.type === "Line3D") {
    return { type: "line", start: xyz(curve.start_point).slice(0, 2), end: xyz(curve.end_point).slice(0, 2) };
  }
  if (curve.type === "Circle3D") {
    return { type: "circle", center: xyz(curve.center_point).slice(0, 2), radius: Number(curve.radius) };
  }
  if (curve.type === "Arc3D") {
    // Same construction as CadSeqProc Arc.from_dict: rotate the reference vector
    // by the mid angle around the center.
    const center = xyz(curve.center_point).slice(0, 2);
    const reference = xyz(curve.reference_vector).slice(0, 2);
    const midAngle = (Number(curve.start_angle) + Number(curve.end_angle)) / 2;
    const radius = Number(curve.radius);
    const mid = [
      center[0] + radius * (Math.cos(midAngle) * reference[0] - Math.sin(midAngle) * reference[1]),
      center[1] + radius * (Math.sin(midAngle) * reference[0] + Math.cos(midAngle) * reference[1]),
    ];
    return { type: "arc", start: xyz(curve.start_point).slice(0, 2), mid, end: xyz(curve.end_point).slice(0, 2) };
  }
  throw new Error(`Unsupported DeepCAD curve type "${curve.type}".`);
}

export function deepcadJsonToCadSequence(data) {
  const steps = [];
  for (const item of data.sequence) {
    if (item.type !== "ExtrudeFeature") continue; // sketches are pulled in by the extrude that uses them
    const extrude = data.entities[item.entity];
    if (!extrude) throw new Error(`DeepCAD sequence references missing entity ${item.entity}.`);
    if (extrude.start_extent && extrude.start_extent.type !== "ProfilePlaneStartDefinition") {
      throw new Error(`Extrude ${item.entity}: only ProfilePlaneStartDefinition start extents are supported.`);
    }

    // Group referenced profiles by sketch: one step per (extrude, sketch) pair.
    const bySketch = new Map();
    for (const ref of extrude.profiles || []) {
      if (!bySketch.has(ref.sketch)) bySketch.set(ref.sketch, []);
      bySketch.get(ref.sketch).push(ref.profile);
    }

    let towards = Number(extrude.extent_one?.distance?.value ?? 0);
    let opposite = 0;
    if (extrude.extent_type === "SymmetricFeatureExtentType") {
      towards /= 2;
      opposite = towards;
    } else if (extrude.extent_type === "TwoSidesFeatureExtentType") {
      opposite = Number(extrude.extent_two?.distance?.value ?? 0);
    }
    if (towards < 0) [towards, opposite] = [Math.abs(opposite), Math.abs(towards)];

    const operation = DEEPCAD_OPERATION_NAMES[extrude.operation];
    if (!operation) throw new Error(`Extrude ${item.entity}: unsupported operation "${extrude.operation}".`);

    for (const [sketchId, profileIds] of bySketch) {
      const sketch = data.entities[sketchId];
      if (!sketch || sketch.type !== "Sketch") throw new Error(`Extrude ${item.entity} references missing sketch ${sketchId}.`);
      const faces = profileIds.map((profileId) => {
        const profile = sketch.profiles?.[profileId];
        if (!profile) throw new Error(`Sketch ${sketchId} has no profile ${profileId}.`);
        // Outer loop first, matching the v1 convention.
        const loops = [...profile.loops].sort((a, b) => Number(Boolean(b.is_outer)) - Number(Boolean(a.is_outer)));
        return { loops: loops.map(loop => loop.profile_curves.map(deepcadCurve)) };
      });
      steps.push({
        plane: {
          origin: xyz(sketch.transform.origin),
          xAxis: xyz(sketch.transform.x_axis),
          normal: xyz(sketch.transform.z_axis),
        },
        faces,
        extrude: { towardsNormal: towards, oppositeNormal: opposite, operation },
      });
    }
  }
  // DeepCAD JSON comes from the Onshape API, whose lengths are meters.
  return { format: "cad-sequence/v1", source: "deepcad-json", units: "m", steps };
}

/** Rotation matrix for scipy's R.from_euler("zyx", [a, b, c], degrees=True) (extrinsic). */
export function eulerZyxDegreesToMatrix(angles) {
  const [a, b, c] = angles.map(angle => (Number(angle) * Math.PI) / 180);
  const rz = [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const rx = [[1, 0, 0], [0, Math.cos(c), -Math.sin(c)], [0, Math.sin(c), Math.cos(c)]];
  const mul = (p, q) => p.map(row => q[0].map((_, j) => row.reduce((sum, value, k) => sum + value * q[k][j], 0)));
  return mul(rx, mul(ry, rz));
}

function minimalCurve(key, curve) {
  if (key.startsWith("line")) return { type: "line", start: toNumbers(curve["Start Point"]), end: toNumbers(curve["End Point"]) };
  if (key.startsWith("arc")) {
    return { type: "arc", start: toNumbers(curve["Start Point"]), mid: toNumbers(curve["Mid Point"]), end: toNumbers(curve["End Point"]) };
  }
  if (key.startsWith("circle")) return { type: "circle", center: toNumbers(curve.Center), radius: Number(curve.Radius) };
  throw new Error(`Unsupported minimal-JSON curve "${key}".`);
}

export function text2cadMinimalJsonToCadSequence(data) {
  const steps = Object.values(data.parts).map((part) => {
    // CadSeqProc CoordinateSystem.from_minimal_json: rows of the rotation matrix are the axes.
    const rotation = eulerZyxDegreesToMatrix(part.coordinate_system["Euler Angles"]);
    const operation = DEEPCAD_OPERATION_NAMES[part.extrusion.operation];
    if (!operation) throw new Error(`Unsupported extrusion operation "${part.extrusion.operation}".`);
    return {
      plane: { origin: toNumbers(part.coordinate_system["Translation Vector"]), xAxis: rotation[0], normal: rotation[2] },
      faces: Object.values(part.sketch).map(face => ({
        loops: Object.values(face).map(loop => Object.entries(loop).map(([key, curve]) => minimalCurve(key, curve))),
      })),
      extrude: {
        towardsNormal: Number(part.extrusion.extrude_depth_towards_normal),
        oppositeNormal: Number(part.extrusion.extrude_depth_opposite_normal),
        operation,
      },
    };
  });
  return { format: "cad-sequence/v1", source: "text2cad-minimal-json", units: "normalized", steps };
}

// ─── validation ─────────────────────────────────────────────────────────────

function curveEndpoints(curve) {
  if (curve.type === "circle") return null;
  return [curve.start, curve.end];
}

/** Returns a list of human-readable problems; empty means the sequence is compilable. */
export function validateCadSequence(sequence) {
  const errors = [];
  if (!Array.isArray(sequence?.steps) || sequence.steps.length === 0) return ["Sequence has no steps."];
  if (sequence.units && !(sequence.units in UNIT_TO_INCH) && sequence.units !== "normalized") {
    errors.push(`Unknown units "${sequence.units}".`);
  }
  sequence.steps.forEach((step, stepIndex) => {
    const where = `step ${stepIndex + 1}`;
    const plane = step.plane || {};
    if (!isFiniteVector(plane.origin, 3)) errors.push(`${where}: plane.origin must be [x,y,z].`);
    if (!isFiniteVector(plane.normal, 3) || norm(toNumbers(plane.normal)) < EPS) errors.push(`${where}: plane.normal must be a non-zero [x,y,z].`);
    if (!isFiniteVector(plane.xAxis, 3)) errors.push(`${where}: plane.xAxis must be [x,y,z].`);
    else if (isFiniteVector(plane.normal, 3) && norm(cross(toNumbers(plane.xAxis), toNumbers(plane.normal))) < 1e-6) {
      errors.push(`${where}: plane.xAxis is parallel to the normal.`);
    }
    const extrude = step.extrude || {};
    const towards = Number(extrude.towardsNormal);
    const opposite = Number(extrude.oppositeNormal || 0);
    if (!Number.isFinite(towards) || !Number.isFinite(opposite)) errors.push(`${where}: extrude depths must be numbers.`);
    else if (Math.abs(towards + opposite) < EPS) errors.push(`${where}: extrude has zero total depth.`);
    if (!OPERATIONS.includes(extrude.operation)) errors.push(`${where}: extrude.operation must be one of ${OPERATIONS.join(", ")}.`);
    if (stepIndex === 0 && (extrude.operation === "cut" || extrude.operation === "intersect")) {
      errors.push(`${where}: the first step cannot be a ${extrude.operation} (there is no body yet).`);
    }
    if (!Array.isArray(step.faces) || step.faces.length === 0) {
      errors.push(`${where}: sketch has no faces.`);
      return;
    }
    step.faces.forEach((face, faceIndex) => {
      if (!Array.isArray(face.loops) || face.loops.length === 0) errors.push(`${where} face ${faceIndex + 1}: no loops.`);
      (face.loops || []).forEach((loop, loopIndex) => {
        const loopWhere = `${where} face ${faceIndex + 1} loop ${loopIndex + 1}`;
        if (!Array.isArray(loop) || loop.length === 0) {
          errors.push(`${loopWhere}: empty loop.`);
          return;
        }
        for (const curve of loop) {
          if (curve.type === "line") {
            if (!isFiniteVector(curve.start, 2) || !isFiniteVector(curve.end, 2)) errors.push(`${loopWhere}: line needs start/end [u,v].`);
          } else if (curve.type === "arc") {
            if (!["start", "mid", "end"].every(key => isFiniteVector(curve[key], 2))) errors.push(`${loopWhere}: arc needs start/mid/end [u,v].`);
          } else if (curve.type === "circle") {
            if (!isFiniteVector(curve.center, 2) || !(Number(curve.radius) > 0)) errors.push(`${loopWhere}: circle needs center [u,v] and radius > 0.`);
          } else {
            errors.push(`${loopWhere}: unknown curve type "${curve.type}".`);
          }
        }
        // A loop of open curves must close: each end meets the next start.
        const open = loop.map(curveEndpoints).filter(Boolean);
        if (open.length && open.length === loop.length) {
          const span = Math.max(...open.flat().flat().map(Math.abs), 1e-6);
          const gap = (a, b) => Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
          for (let i = 0; i < open.length; i += 1) {
            const next = open[(i + 1) % open.length];
            if (gap(open[i][1], next[0]) > span * 1e-3 && gap(open[i][1], next[1]) > span * 1e-3) {
              errors.push(`${loopWhere}: curve ${i + 1} does not connect to curve ${((i + 1) % open.length) + 1}.`);
              break;
            }
          }
        }
      });
    });
  });
  return errors;
}

// ─── compiler ───────────────────────────────────────────────────────────────

function fmt(value) {
  const rounded = Number(Number(value).toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function curvePoints(curve) {
  if (curve.type === "circle") {
    const [u, v] = curve.center;
    const r = curve.radius;
    return [[u - r, v - r], [u + r, v + r]];
  }
  return curve.type === "arc" ? [curve.start, curve.mid, curve.end] : [curve.start, curve.end];
}

function frameFor(plane) {
  const normal = unit(toNumbers(plane.normal));
  const rawX = toNumbers(plane.xAxis);
  const xAxis = unit(sub(rawX, scale(normal, dot(rawX, normal)))); // Gram-Schmidt
  return { origin: toNumbers(plane.origin), normal, xAxis, yAxis: cross(normal, xAxis) };
}

// Largest dimension of the bodies that add material (cut/intersect tools are
// often oversized "through all" prisms and would inflate the part size).
function boundingSize(sequence) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (point) => point.forEach((value, i) => { min[i] = Math.min(min[i], value); max[i] = Math.max(max[i], value); });
  for (const step of sequence.steps) {
    if (step.extrude.operation === "cut" || step.extrude.operation === "intersect") continue;
    const frame = frameFor(step.plane);
    const towards = Number(step.extrude.towardsNormal);
    const opposite = Number(step.extrude.oppositeNormal || 0);
    for (const face of step.faces) {
      for (const loop of face.loops) {
        for (const curve of loop) {
          for (const [u, v] of curvePoints(curve)) {
            const point = add(add(frame.origin, scale(frame.xAxis, Number(u))), scale(frame.yAxis, Number(v)));
            grow(add(point, scale(frame.normal, towards)));
            grow(sub(point, scale(frame.normal, opposite)));
          }
        }
      }
    }
  }
  return Math.max(...max.map((value, i) => value - min[i]));
}

function sanitizeName(name, fallback) {
  const cleaned = String(name || "").replace(/[^a-zA-Z0-9_]/g, "");
  return /^[a-zA-Z]/.test(cleaned) ? cleaned.slice(0, 48) : fallback;
}

/**
 * Compile any supported sequence into a FeatureScript 2931 custom feature.
 * Options: featureName, featureLabel, sizeInches (overrides the default overall size).
 * Returns { ok, code, featureName, featureLabel, sequence, warnings } or { ok: false, errors }.
 */
export function compileCadSequenceToFeatureScript(input, options = {}) {
  let sequence;
  try {
    sequence = toCadSequence(input);
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
  const errors = validateCadSequence(sequence);
  if (errors.length) return { ok: false, errors, sequence };

  const warnings = [];
  const nominal = boundingSize(sequence);
  if (!(nominal > EPS)) return { ok: false, errors: ["Sequence has zero size."], sequence };

  // All geometry is written relative to the part's largest dimension (so numbers
  // stay readable) and scaled by one editable "Overall Size" parameter.
  const units = sequence.units || "normalized";
  let defaultSize = units === "normalized" ? DEFAULT_NORMALIZED_SIZE_INCH : nominal * UNIT_TO_INCH[units];
  if (Number(options.sizeInches) > 0) defaultSize = Number(options.sizeInches);
  const boundedSize = Math.min(Math.max(defaultSize, 0.05), 200);
  if (boundedSize !== defaultSize) warnings.push(`Overall size ${fmt(defaultSize)} in was clamped to ${fmt(boundedSize)} in.`);
  const k = 1 / nominal;

  const featureName = sanitizeName(options.featureName, "deepcadPart");
  const featureLabel = String(options.featureLabel || "DeepCAD Part").replace(/["\\]/g, "").slice(0, 60) || "DeepCAD Part";

  const body = [];
  body.push(`        var skPlane = isQueryEmpty(context, definition.location)`);
  body.push(`            ? plane(WORLD_ORIGIN, Z_DIRECTION)`);
  body.push(`            : evPlane(context, { "face" : definition.location });`);
  body.push(`        var skY = cross(skPlane.normal, skPlane.x);`);
  body.push(`        // Every coordinate below is a fraction of the part's largest dimension.`);
  body.push(`        var s = definition.overallSize / inch;`);
  body.push("");

  // Directions and points are expressed in the chosen placement plane's frame so
  // the whole part moves with the "Plane" selection.
  const factor = value => (Number(fmt(value)) < 0 ? `(${fmt(value)})` : fmt(value));
  const dir = v => `(skPlane.x * ${factor(v[0])} + skY * ${factor(v[1])} + skPlane.normal * ${factor(v[2])})`;
  const uv = (point) => `vector(${fmt(Number(point[0]) * k)}, ${fmt(Number(point[1]) * k)}) * s * inch`;

  const bodyIds = []; // operation ids that may own solid bodies of this part
  const sketchIds = [];
  const solidsOf = ids => `qBodyType(qUnion([${ids.map(ref => `qCreatedBy(id + "${ref}", EntityType.BODY)`).join(", ")}]), BodyType.SOLID)`;

  sequence.steps.forEach((step, stepIndex) => {
    const n = stepIndex + 1;
    const frame = frameFor(step.plane);
    const towards = Number(step.extrude.towardsNormal);
    const opposite = Number(step.extrude.oppositeNormal || 0);
    // A two-sided extrude from -opposite to +towards equals a one-sided extrude of
    // (towards + opposite) from a plane shifted back by `opposite`.
    let start = -opposite;
    let depth = towards + opposite;
    if (depth < 0) {
      start = towards;
      depth = -depth;
    }
    const origin = scale(add(frame.origin, scale(frame.normal, start)), k);
    const operation = step.extrude.operation;

    body.push(`        // Step ${n}: ${operation} extrude, depth ${fmt(depth * k)} × size`);
    // Onshape requires the plane's x axis to be perpendicular to its normal within
    // 1e-11, so re-orthogonalize at runtime instead of trusting rounded literals.
    body.push(`        var n${n} = normalize(${dir(frame.normal)});`);
    body.push(`        var x${n} = ${dir(frame.xAxis)};`);
    body.push(`        x${n} = normalize(x${n} - n${n} * dot(x${n}, n${n}));`);
    body.push(`        var pl${n} = plane(skPlane.origin + ${dir(origin)} * s * inch, n${n}, x${n});`);

    const regions = [];
    step.faces.forEach((face, faceIndex) => {
      // One sketch per face: qSketchRegion(..., true) then keeps exactly that face
      // (outer loop minus its holes), and islands stay separate faces.
      const sketchId = `sk${n}f${faceIndex + 1}`;
      const sketchVar = `sketch${n}f${faceIndex + 1}`;
      sketchIds.push(sketchId);
      regions.push(`qSketchRegion(id + "${sketchId}", true)`);
      body.push(`        var ${sketchVar} = newSketchOnPlane(context, id + "${sketchId}", { "sketchPlane" : pl${n} });`);
      let curveIndex = 0;
      for (const loop of face.loops) {
        for (const curve of loop) {
          curveIndex += 1;
          if (curve.type === "line") {
            body.push(`        skLineSegment(${sketchVar}, "line${curveIndex}", { "start" : ${uv(curve.start)}, "end" : ${uv(curve.end)} });`);
          } else if (curve.type === "arc") {
            body.push(`        skArc(${sketchVar}, "arc${curveIndex}", { "start" : ${uv(curve.start)}, "mid" : ${uv(curve.mid)}, "end" : ${uv(curve.end)} });`);
          } else {
            body.push(`        skCircle(${sketchVar}, "circle${curveIndex}", { "center" : ${uv(curve.center)}, "radius" : ${fmt(Number(curve.radius) * k)} * s * inch });`);
          }
        }
      }
      body.push(`        skSolve(${sketchVar});`);
    });

    const extrudeId = `extrude${n}`;
    const entities = regions.length === 1 ? regions[0] : `qUnion([${regions.join(", ")}])`;
    body.push(`        opExtrude(context, id + "${extrudeId}", {`);
    body.push(`            "entities"  : ${entities},`);
    body.push(`            "direction" : pl${n}.normal,`);
    body.push(`            "endBound"  : BoundingType.BLIND,`);
    body.push(`            "endDepth"  : ${fmt(depth * k)} * s * inch`);
    body.push(`        });`);

    const previous = [...bodyIds];
    if (previous.length && (operation === "new" || operation === "join")) {
      // CadSeqProc fuses both new bodies and joins into the running solid.
      body.push(`        opBoolean(context, id + "union${n}", {`);
      body.push(`            "tools" : ${solidsOf([...previous, extrudeId])},`);
      body.push(`            "operationType" : BooleanOperationType.UNION`);
      body.push(`        });`);
      bodyIds.push(extrudeId, `union${n}`);
    } else if (operation === "cut") {
      body.push(`        opBoolean(context, id + "cut${n}", {`);
      body.push(`            "tools" : qCreatedBy(id + "${extrudeId}", EntityType.BODY),`);
      body.push(`            "targets" : ${solidsOf(previous)},`);
      body.push(`            "operationType" : BooleanOperationType.SUBTRACTION`);
      body.push(`        });`);
      bodyIds.push(`cut${n}`);
    } else if (operation === "intersect") {
      body.push(`        opBoolean(context, id + "intersect${n}", {`);
      body.push(`            "tools" : ${solidsOf([...previous, extrudeId])},`);
      body.push(`            "operationType" : BooleanOperationType.INTERSECTION`);
      body.push(`        });`);
      bodyIds.push(extrudeId, `intersect${n}`);
    } else {
      bodyIds.push(extrudeId);
    }
    body.push("");
  });

  body.push(`        // Remove the construction sketches so only the solid remains.`);
  body.push(`        opDeleteBodies(context, id + "deleteSketches", {`);
  body.push(`            "entities" : qUnion([${sketchIds.map(ref => `qCreatedBy(id + "${ref}", EntityType.BODY)`).join(", ")}])`);
  body.push(`        });`);

  const code = `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "${featureLabel}" }
export const ${featureName} = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Overall Size" }
        isLength(definition.overallSize, { (inch) : [0.05, ${fmt(boundedSize)}, 200] } as LengthBoundSpec);
    }
    {
${body.join("\n").trimEnd()}
    });
`;

  return {
    ok: true,
    code,
    featureName,
    featureLabel,
    sequence,
    warnings,
    stats: {
      steps: sequence.steps.length,
      faces: sketchIds.length,
      curves: sequence.steps.reduce((sum, step) => sum + step.faces.reduce((f, face) => f + face.loops.flat().length, 0), 0),
      defaultSizeInches: Number(fmt(boundedSize)),
    },
  };
}
