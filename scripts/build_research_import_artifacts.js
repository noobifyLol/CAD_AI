import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DATA = join(ROOT, "data");
const DOCS = join(ROOT, "docs", "research_summaries");
const LOGS = join(ROOT, "logs");
const FS_DIR = join(DATA, "fs_examples");

const csvColumns = [
  "title",
  "summary",
  "tags",
  "keywords",
  "parameter_hints",
  "modeling_notes",
  "feature_pattern",
  "failure_modes",
  "validation_rules",
  "example_prompt",
  "shape_type",
  "memory_type",
  "quality_score",
  "source_table",
  "memory_only",
];

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows) {
  return [
    csvColumns.join(","),
    ...rows.map(row => csvColumns.map(col => csvEscape(row[col])).join(",")),
  ].join("\n") + "\n";
}

function row(base) {
  return {
    title: base.title,
    summary: base.summary,
    tags: base.tags || "",
    keywords: base.keywords || "",
    parameter_hints: base.parameter_hints || "",
    modeling_notes: base.modeling_notes || "",
    feature_pattern: base.feature_pattern || "",
    failure_modes: base.failure_modes || "",
    validation_rules: base.validation_rules || "",
    example_prompt: base.example_prompt || "",
    shape_type: base.shape_type || "CUSTOM",
    memory_type: base.memory_type || "seed",
    quality_score: base.quality_score ?? 0.86,
    source_table: base.source_table || "cad_knowledge",
    memory_only: base.memory_only ?? false,
  };
}

const knowledgeRows = [
  row({
    title: "CAD-MLLM Hierarchical Command Decomposition",
    summary: "Break a prompt into sketch, profile, operation, boolean, and finishing subtasks before writing FeatureScript.",
    tags: "cad-mllm;planning;decomposition;command-sequence",
    keywords: "plan;decompose;retrieve;generate;validate;repair;command;sequence;subtask",
    parameter_hints: "shapeClass;operation;profileCount;featureOrder;fallbackTemplate",
    modeling_notes: "Classify the requested shape before code generation.;Select revolve, loft, sweep, extrude, shell, pattern, or boolean per subtask.;Attach validation rules and retrieval keywords to every subtask.;Use fallback templates only after repair fails.",
    feature_pattern: "prompt -> ordered subtasks -> retrieved rows/snippets -> one FeatureScript body -> validation/repair/fallback.",
    failure_modes: "single-shot hallucinated API;wrong primitive choice;lost parameters",
    validation_rules: "plan.subtasks.length >= 1;each subtask has operation and validationFocus;fallbackTemplate is defined",
    example_prompt: "Create a carrot-like body with a mounting flange and bolt holes",
  }),
  row({
    title: "Silhouette Driven Organic Revolve",
    summary: "Use a closed side silhouette and a true sketch-plane axis to create stable organic axisymmetric shapes.",
    tags: "revolve;organic;silhouette;spline",
    keywords: "revolve;silhouette;skFitSpline;axis;Line;carrot;vase;pod",
    parameter_hints: "baseRadius;height;tipRadius;curvatureFactor;controlPointFractions",
    modeling_notes: "Draw axis at sketch x=0 and keep all profile x values nonnegative.;Use 5 to 7 spline control points at percentage heights.;Close the profile with axis, base, and top line segments.;Call skSolve before opRevolve.;Use line(skPlane.origin, cross(skPlane.normal, skPlane.x)) for a local Y-axis revolve.",
    feature_pattern: "axis + 5-point skFitSpline + closing lines + skSolve + opRevolve(profileSubquery, Line axis, 2*PI*radian).",
    failure_modes: "axis not a Line;open profile;spline crosses axis;only two spline points",
    validation_rules: "all profile x >= 0;tipRadius <= baseRadius;skSolve before opRevolve;axis expression returns Line",
    example_prompt: "Parametric carrot 0.75 inch base radius 4 inch height with smooth taper",
  }),
  row({
    title: "Multi Profile Loft Transition",
    summary: "Loft stable transitions by solving separate, ordered profile sketches on offset planes with matching topology or intermediate profiles.",
    tags: "loft;transition;profiles;organic",
    keywords: "opLoft;profileSubqueries;square;circle;intermediate;topology",
    parameter_hints: "height;squareSize;circleRadius;profileOffset;intermediateScale",
    modeling_notes: "Each loft section should be its own solved sketch.;Use profileSubqueries in order along the loft direction.;For circle-to-rectangle transitions, insert a rounded-square or multi-profile bridge.;Keep profiles centered on a shared axis unless prompt says otherwise.",
    feature_pattern: "sketchA on base plane + sketchB on offset plane + skSolve both + opLoft({profileSubqueries:[qSketchRegion(...), ...]}).",
    failure_modes: "topology mismatch;wrong opLoft keys;unsolved profile sketch;profiles out of order",
    validation_rules: "profile_similarity_score >= 0.7 or insert intermediate profile;opLoft uses profileSubqueries;all profiles solved",
    example_prompt: "Create a 2 inch square to 1 inch circle transition over 3 inches",
  }),
  row({
    title: "Sweep Along Connected Tube Path",
    summary: "For elbows and pipes, sketch a connected path wire and sweep a profile from a plane normal to the starting tangent.",
    tags: "sweep;pipe;tube;path;elbow",
    keywords: "opSweep;profile;path;arc;wire;perpendicular;pipe elbow",
    parameter_hints: "outerRadius;bendRadius;wallThickness;pathAngle;profilePlane",
    modeling_notes: "Create the path sketch first and solve it.;Place the circular profile on a plane perpendicular to the start tangent.;Use qCreatedBy(pathSketch, EntityType.EDGE) for the path.;For hollow pipes, add an inner circle to the profile region.",
    feature_pattern: "path sketch arc + skSolve + perpendicular profile sketch circle + skSolve + opSweep({profiles:qSketchRegion(profile), path:qCreatedBy(path, EDGE)}).",
    failure_modes: "disconnected path;profile not perpendicular;profile larger than bend radius;path query is a region",
    validation_rules: "path edges connected;outerRadius < bendRadius;profile sketch solved before opSweep",
    example_prompt: "Create a 90 degree pipe elbow with 0.5 inch radius and 2 inch bend radius",
  }),
  row({
    title: "Shell First Enclosure Workflow",
    summary: "Build a simple extruded envelope first, then shell it with a wall thickness that leaves valid interior volume.",
    tags: "shell;enclosure;housing;open-top",
    keywords: "opShell;enclosure;wall thickness;open face;electronics housing",
    parameter_hints: "width;depth;height;wallThickness;openTop",
    modeling_notes: "Sketch the outer rectangle and extrude before shelling.;Pass the face to remove/open to opShell and use negative thickness for inward shells.;Keep wallThickness less than half of width, depth, and height.;Add vents, bosses, and fillets after the shell succeeds.",
    feature_pattern: "outer sketch + skSolve + opExtrude + opShell(open face query, -wallThickness).",
    failure_modes: "wall consumes cavity;opShell before body exists;wrong open face;decorative details first",
    validation_rules: "wallThickness < min(width,depth,height)/2;opShell occurs after opExtrude;open face query is a face",
    example_prompt: "Open-top electronics enclosure 4 x 3 x 1.5 inches with 0.1 inch walls",
    shape_type: "BOX",
  }),
  row({
    title: "Hybrid Organic Mechanical Flange",
    summary: "Combine an organic revolved body with a mechanically reliable flange, bolt circle, and boolean union.",
    tags: "hybrid;organic;flange;boolean;bolt-circle",
    keywords: "carrot;flange;bolt holes;opBoolean;revolve;pattern",
    parameter_hints: "baseRadius;height;flangeRadius;flangeThickness;boltCircleRadius;boltRadius",
    modeling_notes: "Create the organic body first with a closed revolve profile.;Create the flange on a plane perpendicular to the revolve axis.;Sketch outer ring, bore, and bolt holes in one solved sketch.;Extrude the flange, then union it with the body.",
    feature_pattern: "opRevolve organic body + flange ring sketch + opExtrude + opBoolean UNION.",
    failure_modes: "flange plane not perpendicular;bolt holes outside flange;boolean target/tool reversed",
    validation_rules: "boltCircleRadius + boltRadius < flangeRadius;flange bore >= body base radius;boolean tools and targets are bodies",
    example_prompt: "Create a carrot-like organic body with a four bolt mounting flange",
  }),
  row({
    title: "Multimodal Image To Profile Conditioning",
    summary: "Convert image or sketch metadata into silhouette descriptors, normalized control points, and bounding boxes for the planner.",
    tags: "multimodal;image;silhouette;conditioning",
    keywords: "image;silhouette;control points;bounding box;profile descriptor;CAD-MLLM",
    parameter_hints: "imageWidth;imageHeight;aspectRatio;normalizedControlPoints;shapeClass",
    modeling_notes: "Extract dimensions and aspect ratio from PNG/JPEG headers when no vision model is available.;Use user-provided silhouette points directly when present.;Feed normalized control points to revolve or loft planners.;Log descriptor confidence so retrieval can favor robust templates.",
    feature_pattern: "image/STEP/PCD -> bbox + control points + dominant axis -> plan retrieval keywords -> FS generation.",
    failure_modes: "unavailable image decoder;ambiguous silhouette;bad scale inference",
    validation_rules: "descriptor.hasMultimodalInput implies descriptor.summary exists;control points remain normalized [0,1]",
    example_prompt: "Use this sketch silhouette to make a smooth vase",
  }),
  row({
    title: "DeepCAD Sketch Extrude Sequence Memory",
    summary: "DeepCAD-style JSON command sequences can be summarized as solved profile sketches followed by parametric extrudes.",
    tags: "deepcad;dataset;sketch;extrude;sequence",
    keywords: "DeepCAD;sketch;extrude;Circle3D;Line3D;command sequence;CAD dataset",
    parameter_hints: "profileCurves;loopCount;extrudeDistance;operation",
    modeling_notes: "Parse entities for Sketch and ExtrudeFeature records.;Convert closed line/circle loops into FeatureScript sketches.;Keep dataset units as source metadata, then expose Onshape inches defaults.;Use dataset summaries as retrieval snippets instead of importing raw heavy files.",
    feature_pattern: "DeepCAD JSON: Sketch profiles + ExtrudeFeature distance -> FS sketch + skSolve + opExtrude.",
    failure_modes: "raw dataset too large;unknown units;non-closed loops;unsupported feature type",
    validation_rules: "sample has at least one sketch and one operation;closed loops become qSketchRegion;raw archives stay gitignored",
    example_prompt: "Generate a simple spacer from a DeepCAD circle sketch plus extrude command",
  }),
  row({
    title: "Visual Inspection Repair Loop",
    summary: "Use validation and visual feedback to detect spatial mismatches, then repair or replan before finalizing.",
    tags: "agent;visual-inspection;repair;validation",
    keywords: "visual inspection;repair;replan;spatial reasoning;agent workflow",
    parameter_hints: "viewCount;validationIssues;repairAttempts;fallbackTemplate",
    modeling_notes: "The Cambridge workflow shows visual feedback improves automated CAD generation.;Use multiple view descriptors when available, not a single perspective.;Record every repair attempt and retrieved row for traceability.;If repair fails, fallback to a validated template and mark the log.",
    feature_pattern: "generate -> static validate -> debug/repair -> optional visual descriptor check -> fallback template.",
    failure_modes: "single-view misses;prompt dependency;spatial ambiguity;ask-back distraction",
    validation_rules: "trace includes retrieved rows and scores;fallback_template true when repairs exhausted",
    example_prompt: "Attempt a circle-to-rectangle loft and repair if profiles mismatch",
  }),
  row({
    title: "Lofted Airfoil Section Stack",
    summary: "Create wings and fins by lofting two or more airfoil-like closed spline profiles with chord, thickness, and span parameters.",
    tags: "airfoil;loft;wing;spline",
    keywords: "airfoil;loft;chord;thickness;span;skFitSpline",
    parameter_hints: "rootChord;tipChord;span;thicknessRatio;sweepOffset",
    modeling_notes: "Use closed upper/lower spline profiles on root and tip planes.;Keep profile point counts similar across sections.;Add sweep offset as a plane origin shift rather than skewing the profile topology.;Use opLoft profileSubqueries.",
    feature_pattern: "root airfoil sketch + tip airfoil sketch + skSolve both + opLoft(profileSubqueries).",
    failure_modes: "open airfoil profile;different point count;tip chord too small;wrong loft key",
    validation_rules: "tipChord > 0;thicknessRatio between 0.03 and 0.2;profileSubqueries ordered root to tip",
    example_prompt: "Loft a simple airfoil from 3 inch root chord to 1.5 inch tip chord over 8 inches",
  }),
  row({
    title: "Dataset Examples As Retrieval Snippets",
    summary: "Represent large CAD datasets as compact memory rows with operation counts, curve types, and template hints instead of committing raw data.",
    tags: "dataset;retrieval;memory;omni-cad;deepcad",
    keywords: "Omni-CAD;DeepCAD;cad_memory;retrieval snippet;training pair",
    parameter_hints: "datasetName;sampleId;curveTypes;operationCounts;qualityScore",
    modeling_notes: "Store heavy archives outside git and ingest only compact metadata.;Map common circle+extrude samples to spacer, bushing, washer, or cylinder templates.;Map rectangular loops to box, plate, enclosure, or bracket templates.;Use labeled feature vectors to train the adaptive reranker.",
    feature_pattern: "archive sample -> compact cad_memory row -> adaptive_training vector -> reranker state.",
    failure_modes: "committing 14GB raw data;overfitting to file names;opaque sample metadata",
    validation_rules: "raw archives are gitignored;memory row has qualityScore and source_table=cad_memory",
    example_prompt: "Use dataset examples to choose a robust bushing template",
  }),
];

const pruningRows = [
  row({
    title: "Loft Profiles Must Be Topologically Similar",
    summary: "If two loft profiles differ strongly, insert intermediate profiles or fallback to a revolve/multi-profile strategy.",
    tags: "pruning;loft;topology;mismatch",
    keywords: "loft;profile similarity;circle rectangle;intermediate profile;fallback",
    parameter_hints: "profile_similarity_score;profile_count;intermediateScale",
    modeling_notes: "Trigger when profile loop counts, curve counts, or semantic classes differ.;Use a rounded-square intermediate for circle-to-rectangle transitions.;Keep all sections centered and solved.",
    feature_pattern: "if similarity < 0.7 then add 3rd profile or fallback_to_revolve_or_multi_profile.",
    failure_modes: "loft twist;missing body;self-intersection;invalid profileSubqueries",
    validation_rules: "profile_similarity_score >= 0.7 else insert intermediate profile;all sketches solved",
    example_prompt: "Attempt to loft a circle to a rectangle",
    memory_type: "pruning_rule",
    quality_score: 0.94,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Use Current opLoft profileSubqueries Key",
    summary: "The local FS docs use profileSubqueries for opLoft; repair older edges, sections, or vertices keys before returning code.",
    tags: "pruning;loft;featurescript-api",
    keywords: "opLoft;profileSubqueries;edges;sections;vertices;repair",
    parameter_hints: "profileSubqueries",
    modeling_notes: "Trigger on opLoft maps containing edges, sections, or vertices.;Replace with ordered profileSubqueries array.;Do not pass sketch variables directly.",
    feature_pattern: "opLoft(context,id,{\"profileSubqueries\":[qSketchRegion(id+\"a\"), qSketchRegion(id+\"b\")]}).",
    failure_modes: "invalid map key;no loft result",
    validation_rules: "opLoft map contains profileSubqueries;does not contain edges/sections/vertices",
    example_prompt: "Loft square to circle over 3 inches",
    memory_type: "pruning_rule",
    quality_score: 0.95,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Sweep Path Must Be A Connected Wire",
    summary: "Reject sweep attempts where the path is a sketch region, multiple disconnected edges, or an unsolved sketch.",
    tags: "pruning;sweep;path",
    keywords: "opSweep;path;wire;connected;arc;edge",
    parameter_hints: "pathContinuity;profileRadius;bendRadius",
    modeling_notes: "Trigger when path uses qSketchRegion or disconnected entities.;Use qCreatedBy(pathSketch, EntityType.EDGE).;Ensure profile radius is smaller than bend radius.",
    feature_pattern: "path=qCreatedBy(id+\"path\", EntityType.EDGE); profiles=qSketchRegion(id+\"profile\").",
    failure_modes: "disconnected path;wrong query type;zero sweep",
    validation_rules: "path query targets edges;path sketch solved;outerRadius < bendRadius",
    example_prompt: "90 degree elbow pipe",
    memory_type: "pruning_rule",
    quality_score: 0.92,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Sweep Profile Plane Perpendicular To Start Tangent",
    summary: "Place sweep profiles on a plane normal to the first path tangent to prevent twisted or failed sweeps.",
    tags: "pruning;sweep;profile-plane",
    keywords: "sweep;profile plane;perpendicular;tangent;pipe",
    parameter_hints: "pathStart;tangentStart;profilePlane",
    modeling_notes: "Trigger when profile is on the same plane as the path.;Construct profilePlane from path start and tangent direction.;For elbow arcs, tangent is cross(skPlane.normal, skPlane.x) at the start.",
    feature_pattern: "profilePlane = plane(pathStart, tangentStart, skPlane.normal).",
    failure_modes: "profile coplanar with path;twisted sweep;self-intersection",
    validation_rules: "profilePlane.normal approximately tangentStart;profile sketch solved",
    example_prompt: "Sweep a circular tube along an arc",
    memory_type: "pruning_rule",
    quality_score: 0.9,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Revolve Axis Must Be A Sketch Plane Line",
    summary: "opRevolve requires a Line value in the sketch plane, not qSketchEntity, qCreatedBy, or a perpendicular plane normal for side silhouettes.",
    tags: "pruning;revolve;axis",
    keywords: "opRevolve;axis;Line;cross;skPlane.x;skPlane.normal",
    parameter_hints: "axisDirection;profileSide",
    modeling_notes: "Trigger when axis is a query or missing line().;For x=0 profile axes, use line(skPlane.origin, cross(skPlane.normal, skPlane.x)).;Keep the axis coincident with the profile closing edge.",
    feature_pattern: "var axis = line(skPlane.origin, cross(skPlane.normal, skPlane.x)); opRevolve(..., {\"axis\": axis}).",
    failure_modes: "axis not a Line;flat disk instead of vertical body;open revolve region",
    validation_rules: "axis expression is line(...);profile includes x=0 axis segment",
    example_prompt: "Organic carrot revolved around x=0 axis",
    memory_type: "pruning_rule",
    quality_score: 0.95,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Organic Spline Control Points Must Stay Stable",
    summary: "Prevent organic splines from crossing the axis, collapsing to two points, or producing self-intersections.",
    tags: "pruning;organic;spline",
    keywords: "skFitSpline;control points;self intersection;axis crossing;organic",
    parameter_hints: "controlPointCount;curvatureFactor;tipRadius;baseRadius",
    modeling_notes: "Trigger when controlPointCount < 4 or any x < 0.;Clamp tipRadius below baseRadius.;Use monotonic height fractions and gentle curvature multipliers.",
    feature_pattern: "5-7 monotonic points at 0,20,45,70,100 percent height with x >= 0.",
    failure_modes: "self-intersecting revolve profile;open profile;straight cone only",
    validation_rules: "controlPointCount >= 5;all x >= 0;tipRadius <= baseRadius",
    example_prompt: "5 point spline carrot",
    memory_type: "pruning_rule",
    quality_score: 0.93,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Shell Thickness Must Preserve Interior Volume",
    summary: "Reject enclosure shells where wall thickness is too large for width, depth, or height.",
    tags: "pruning;shell;wall-thickness",
    keywords: "opShell;wall thickness;enclosure;open top;cavity",
    parameter_hints: "wallThickness;width;depth;height",
    modeling_notes: "Trigger when wallThickness >= 0.5 * min(width, depth, height).;Reduce wall thickness or scale the envelope.;Shell after the base body exists.",
    feature_pattern: "if wallThickness too large then wallThickness = min(width,depth,height)*0.08.",
    failure_modes: "shell failure;zero interior cavity;inside-out shell",
    validation_rules: "wallThickness < min(width,depth,height)/2;opShell after opExtrude",
    example_prompt: "Open-top electronics enclosure with 0.1 inch walls",
    shape_type: "BOX",
    memory_type: "pruning_rule",
    quality_score: 0.91,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Boolean Tools And Targets Must Be Separate Bodies",
    summary: "Boolean operations should not reference the same body as both tool and target, and should happen after both bodies exist.",
    tags: "pruning;boolean;union;subtract",
    keywords: "opBoolean;tools;targets;union;subtraction;body",
    parameter_hints: "toolQuery;targetQuery;operationType",
    modeling_notes: "Trigger when tools and targets share the same qCreatedBy id.;Create cut tools or flange bodies before boolean.;For simple holes, prefer sketch inner loops over subtract tools.",
    feature_pattern: "opBoolean(context,id,{tools:qCreatedBy(toolBody,BODY), targets:qCreatedBy(targetBody,BODY), operationType:UNION}).",
    failure_modes: "no-op boolean;body deleted;invalid query",
    validation_rules: "tools != targets;tool and target operation ids exist before boolean",
    example_prompt: "Organic body with mounting flange",
    memory_type: "pruning_rule",
    quality_score: 0.88,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Sketch Region Queries Must Use Sketch Id",
    summary: "qSketchRegion must receive the sketch id expression, not the sketch variable object.",
    tags: "pruning;sketch;query;featurescript",
    keywords: "qSketchRegion;sketch variable;id;skSolve;region",
    parameter_hints: "sketchId",
    modeling_notes: "Trigger on qSketchRegion(sketch) or qSketchRegion(sk).;Replace with qSketchRegion(id + \"sketchName\").;Use qSketchRegion(id + \"sketchName\", true) for loops with holes when needed.",
    feature_pattern: "qSketchRegion(id + \"profile\") not qSketchRegion(profileSketch).",
    failure_modes: "invalid query;no region found;compile error",
    validation_rules: "qSketchRegion argument contains id + string",
    example_prompt: "Any sketch based generation",
    memory_type: "pruning_rule",
    quality_score: 0.96,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Parameters Must Be Exposed In Precondition",
    summary: "All user-requested dimensions and counts must be editable with FeatureScript precondition declarations.",
    tags: "pruning;parameters;precondition",
    keywords: "isLength;isInteger;boolean;precondition;editable",
    parameter_hints: "requestedParameterNames",
    modeling_notes: "Trigger when prompt names a dimension but code hardcodes it.;Use isLength for dimensional values and isInteger bounds for counts or percentages.;Use boolean for toggles.",
    feature_pattern: "annotation + isLength/isInteger/boolean for every requested parameter.",
    failure_modes: "hardcoded dimensions;non-editable output;invalid precondition syntax",
    validation_rules: "requested params appear as definition.param in precondition and body",
    example_prompt: "Expose baseRadius, height, curvatureFactor, and tipRadius",
    memory_type: "pruning_rule",
    quality_score: 0.93,
    source_table: "pruning_table",
    memory_only: true,
  }),
  row({
    title: "Fillet And Chamfer Last",
    summary: "Apply fillets and chamfers only after primary solids, booleans, shells, and patterns are valid.",
    tags: "pruning;fillet;chamfer;order",
    keywords: "opFillet;opChamfer;edge finishing;operation order",
    parameter_hints: "filletRadius;chamferWidth;edgeSpan",
    modeling_notes: "Trigger when fillet/chamfer appears before solid creation.;Clamp radius below local edge span.;If finishing fails, omit finishing rather than breaking base geometry.",
    feature_pattern: "solid body -> boolean/shell -> optional opFillet/opChamfer.",
    failure_modes: "edge query empty;radius too large;finishing breaks model",
    validation_rules: "opFillet/opChamfer after primary solid;radius < min dimension / 4",
    example_prompt: "Filleted enclosure with chamfered edges",
    memory_type: "pruning_rule",
    quality_score: 0.87,
    source_table: "pruning_table",
    memory_only: true,
  }),
];

const fsExamples = {
  "revolve_carrot.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Organic Revolve Carrot" }
export const organicRevolveCarrot = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Base Radius", "Default" : "0.75 * inch" }
        isLength(definition.baseRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "4 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Tip Radius", "Default" : "0.06 * inch" }
        isLength(definition.tipRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Curvature Factor", "Default" : "100" }
        isInteger(definition.curvatureFactor, {(unitless) : [60, 100, 140]});
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var b = definition.baseRadius / inch;
        var h = definition.height / inch;
        var t = definition.tipRadius / inch;
        var c = definition.curvatureFactor / 100;
        var sk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : skPlane });
        skLineSegment(sk, "axis", { "start" : vector(0, 0) * inch, "end" : vector(0, h) * inch });
        skFitSpline(sk, "skin", { "points" : [
            vector(b, 0) * inch,
            vector(b * (0.88 + 0.04 * c), h * 0.20) * inch,
            vector(b * (0.62 + 0.08 * c), h * 0.45) * inch,
            vector(b * (0.32 + 0.06 * c), h * 0.70) * inch,
            vector(t, h) * inch
        ] });
        skLineSegment(sk, "tipClose", { "start" : vector(t, h) * inch, "end" : vector(0, h) * inch });
        skLineSegment(sk, "baseClose", { "start" : vector(0, 0) * inch, "end" : vector(b, 0) * inch });
        skSolve(sk);
        var revolveAxis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));
        opRevolve(context, id + "body", {
            "entities" : qSketchRegion(id + "profile"),
            "axis" : revolveAxis,
            "angleForward" : 2 * PI * radian
        });
    });`,
  "loft_transition_square_to_circle.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Loft Square To Circle" }
export const loftSquareToCircle = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Square Size", "Default" : "2 * inch" }
        isLength(definition.squareSize, LENGTH_BOUNDS);
        annotation { "Name" : "Circle Radius", "Default" : "0.5 * inch" }
        isLength(definition.circleRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "3 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Profile Offset", "Default" : "0 * inch" }
        isLength(definition.profileOffset, NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS);
    }
    {
        var basePlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var topPlane = plane(basePlane.origin + basePlane.normal * definition.height, basePlane.normal, basePlane.x);
        var halfSquare = definition.squareSize / (2 * inch);
        var skA = newSketchOnPlane(context, id + "squareProfile", { "sketchPlane" : basePlane });
        skRectangle(skA, "square", {
            "firstCorner" : vector(-halfSquare, -halfSquare) * inch,
            "secondCorner" : vector(halfSquare, halfSquare) * inch
        });
        skSolve(skA);
        var skB = newSketchOnPlane(context, id + "circleProfile", { "sketchPlane" : topPlane });
        skCircle(skB, "circle", { "center" : vector(definition.profileOffset / inch, 0) * inch, "radius" : definition.circleRadius });
        skSolve(skB);
        opLoft(context, id + "loft", {
            "profileSubqueries" : [qSketchRegion(id + "squareProfile"), qSketchRegion(id + "circleProfile")]
        });
    });`,
  "sweep_pipe_elbow.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Sweep Pipe Elbow" }
export const sweepPipeElbow = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Outer Radius", "Default" : "0.5 * inch" }
        isLength(definition.outerRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Bend Radius", "Default" : "2 * inch" }
        isLength(definition.bendRadius, LENGTH_BOUNDS);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var r = definition.bendRadius / inch;
        var m = r * 0.70710678;
        var pathSk = newSketchOnPlane(context, id + "path", { "sketchPlane" : skPlane });
        skArc(pathSk, "elbowArc", {
            "start" : vector(r, 0) * inch,
            "mid" : vector(m, m) * inch,
            "end" : vector(0, r) * inch
        });
        skSolve(pathSk);
        var tangentStart = cross(skPlane.normal, skPlane.x);
        var profilePlane = plane(skPlane.origin + skPlane.x * definition.bendRadius, tangentStart, skPlane.normal);
        var profileSk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : profilePlane });
        skCircle(profileSk, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });
        skSolve(profileSk);
        opSweep(context, id + "sweep", {
            "profiles" : qSketchRegion(id + "profile"),
            "path" : qCreatedBy(id + "path", EntityType.EDGE)
        });
    });`,
  "shell_enclosure_open_top.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Open Top Shell Enclosure" }
export const openTopShellEnclosure = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Width", "Default" : "4 * inch" }
        isLength(definition.width, LENGTH_BOUNDS);
        annotation { "Name" : "Depth", "Default" : "3 * inch" }
        isLength(definition.depth, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "1.5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Wall Thickness", "Default" : "0.1 * inch" }
        isLength(definition.wallThickness, LENGTH_BOUNDS);
        annotation { "Name" : "Open Top" }
        definition.openTop is boolean;
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var halfWidth = definition.width / (2 * inch);
        var halfDepth = definition.depth / (2 * inch);
        var sk = newSketchOnPlane(context, id + "base", { "sketchPlane" : skPlane });
        skRectangle(sk, "outer", {
            "firstCorner" : vector(-halfWidth, -halfDepth) * inch,
            "secondCorner" : vector(halfWidth, halfDepth) * inch
        });
        skSolve(sk);
        opExtrude(context, id + "block", {
            "entities" : qSketchRegion(id + "base"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.height
        });
        if (definition.openTop)
        {
            opShell(context, id + "shell", {
                "entities" : qCapEntity(id + "block", CapType.END, EntityType.FACE),
                "thickness" : -definition.wallThickness
            });
        }
    });`,
  "fillet_and_chamfer_example.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Fillet And Chamfer Block" }
export const filletAndChamferBlock = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Width", "Default" : "2 * inch" }
        isLength(definition.width, LENGTH_BOUNDS);
        annotation { "Name" : "Depth", "Default" : "1.25 * inch" }
        isLength(definition.depth, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "0.5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Fillet Radius", "Default" : "0.08 * inch" }
        isLength(definition.filletRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Chamfer Width", "Default" : "0.04 * inch" }
        isLength(definition.chamferWidth, LENGTH_BOUNDS);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var w = definition.width / (2 * inch);
        var d = definition.depth / (2 * inch);
        var sk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : skPlane });
        skRectangle(sk, "rect", { "firstCorner" : vector(-w, -d) * inch, "secondCorner" : vector(w, d) * inch });
        skSolve(sk);
        opExtrude(context, id + "body", {
            "entities" : qSketchRegion(id + "profile"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.height
        });
        opFillet(context, id + "fillet", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "body", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius" : definition.filletRadius
        });
        opChamfer(context, id + "chamfer", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "body", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width" : definition.chamferWidth
        });
    });`,
  "hybrid_organic_flange.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Hybrid Organic Flange" }
export const hybridOrganicFlange = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Base Radius", "Default" : "0.65 * inch" }
        isLength(definition.baseRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "3.5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Tip Radius", "Default" : "0.08 * inch" }
        isLength(definition.tipRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Flange Radius", "Default" : "1.25 * inch" }
        isLength(definition.flangeRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Bolt Circle Radius", "Default" : "0.9 * inch" }
        isLength(definition.boltCircleRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Bolt Radius", "Default" : "0.09 * inch" }
        isLength(definition.boltRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Flange Thickness", "Default" : "0.2 * inch" }
        isLength(definition.flangeThickness, LENGTH_BOUNDS);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var axisDirection = cross(skPlane.normal, skPlane.x);
        var b = definition.baseRadius / inch;
        var h = definition.height / inch;
        var t = definition.tipRadius / inch;
        var bodySk = newSketchOnPlane(context, id + "bodyProfile", { "sketchPlane" : skPlane });
        skLineSegment(bodySk, "axis", { "start" : vector(0, 0) * inch, "end" : vector(0, h) * inch });
        skFitSpline(bodySk, "skin", { "points" : [
            vector(b, 0) * inch,
            vector(b * 0.9, h * 0.25) * inch,
            vector(b * 0.62, h * 0.52) * inch,
            vector(b * 0.34, h * 0.75) * inch,
            vector(t, h) * inch
        ] });
        skLineSegment(bodySk, "top", { "start" : vector(t, h) * inch, "end" : vector(0, h) * inch });
        skLineSegment(bodySk, "base", { "start" : vector(0, 0) * inch, "end" : vector(b, 0) * inch });
        skSolve(bodySk);
        opRevolve(context, id + "organicBody", {
            "entities" : qSketchRegion(id + "bodyProfile"),
            "axis" : line(skPlane.origin, axisDirection),
            "angleForward" : 2 * PI * radian
        });
        var flangePlane = plane(skPlane.origin, axisDirection, skPlane.x);
        var bc = definition.boltCircleRadius / inch;
        var flangeSk = newSketchOnPlane(context, id + "flangeProfile", { "sketchPlane" : flangePlane });
        skCircle(flangeSk, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.flangeRadius });
        skCircle(flangeSk, "bore", { "center" : vector(0, 0) * inch, "radius" : definition.baseRadius });
        skCircle(flangeSk, "bolt0", { "center" : vector(bc, 0) * inch, "radius" : definition.boltRadius });
        skCircle(flangeSk, "bolt1", { "center" : vector(0, bc) * inch, "radius" : definition.boltRadius });
        skCircle(flangeSk, "bolt2", { "center" : vector(-bc, 0) * inch, "radius" : definition.boltRadius });
        skCircle(flangeSk, "bolt3", { "center" : vector(0, -bc) * inch, "radius" : definition.boltRadius });
        skSolve(flangeSk);
        opExtrude(context, id + "flange", {
            "entities" : qSketchRegion(id + "flangeProfile", true),
            "direction" : axisDirection,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.flangeThickness
        });
        opBoolean(context, id + "join", {
            "tools" : qCreatedBy(id + "flange", EntityType.BODY),
            "targets" : qCreatedBy(id + "organicBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });
    });`,
  "vase_multi_profile_loft.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Vase Multi Profile Loft" }
export const vaseMultiProfileLoft = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Height", "Default" : "5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Base Radius", "Default" : "0.8 * inch" }
        isLength(definition.baseRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Belly Radius", "Default" : "1.25 * inch" }
        isLength(definition.bellyRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Neck Radius", "Default" : "0.45 * inch" }
        isLength(definition.neckRadius, LENGTH_BOUNDS);
    }
    {
        var basePlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var midPlane = plane(basePlane.origin + basePlane.normal * (definition.height * 0.55), basePlane.normal, basePlane.x);
        var topPlane = plane(basePlane.origin + basePlane.normal * definition.height, basePlane.normal, basePlane.x);
        var skA = newSketchOnPlane(context, id + "baseProfile", { "sketchPlane" : basePlane });
        skCircle(skA, "base", { "center" : vector(0, 0) * inch, "radius" : definition.baseRadius });
        skSolve(skA);
        var skB = newSketchOnPlane(context, id + "bellyProfile", { "sketchPlane" : midPlane });
        skCircle(skB, "belly", { "center" : vector(0, 0) * inch, "radius" : definition.bellyRadius });
        skSolve(skB);
        var skC = newSketchOnPlane(context, id + "neckProfile", { "sketchPlane" : topPlane });
        skCircle(skC, "neck", { "center" : vector(0, 0) * inch, "radius" : definition.neckRadius });
        skSolve(skC);
        opLoft(context, id + "loft", {
            "profileSubqueries" : [qSketchRegion(id + "baseProfile"), qSketchRegion(id + "bellyProfile"), qSketchRegion(id + "neckProfile")]
        });
    });`,
  "lofted_airfoil.fs": `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Lofted Airfoil" }
export const loftedAirfoil = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Root Chord", "Default" : "3 * inch" }
        isLength(definition.rootChord, LENGTH_BOUNDS);
        annotation { "Name" : "Tip Chord", "Default" : "1.5 * inch" }
        isLength(definition.tipChord, LENGTH_BOUNDS);
        annotation { "Name" : "Span", "Default" : "8 * inch" }
        isLength(definition.span, LENGTH_BOUNDS);
        annotation { "Name" : "Thickness Percent", "Default" : "12" }
        isInteger(definition.thicknessPercent, {(unitless) : [6, 12, 18]});
    }
    {
        var rootPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var tipPlane = plane(rootPlane.origin + rootPlane.normal * definition.span, rootPlane.normal, rootPlane.x);
        var rt = definition.rootChord / inch;
        var tt = definition.tipChord / inch;
        var tr = definition.thicknessPercent / 100;
        var rootSk = newSketchOnPlane(context, id + "root", { "sketchPlane" : rootPlane });
        skFitSpline(rootSk, "rootAirfoil", { "points" : [
            vector(0, 0) * inch,
            vector(rt * 0.25, rt * tr * 0.55) * inch,
            vector(rt * 0.55, rt * tr * 0.36) * inch,
            vector(rt, 0) * inch,
            vector(rt * 0.55, -rt * tr * 0.20) * inch,
            vector(rt * 0.25, -rt * tr * 0.25) * inch,
            vector(0, 0) * inch
        ] });
        skSolve(rootSk);
        var tipSk = newSketchOnPlane(context, id + "tip", { "sketchPlane" : tipPlane });
        skFitSpline(tipSk, "tipAirfoil", { "points" : [
            vector(0, 0) * inch,
            vector(tt * 0.25, tt * tr * 0.55) * inch,
            vector(tt * 0.55, tt * tr * 0.36) * inch,
            vector(tt, 0) * inch,
            vector(tt * 0.55, -tt * tr * 0.20) * inch,
            vector(tt * 0.25, -tt * tr * 0.25) * inch,
            vector(0, 0) * inch
        ] });
        skSolve(tipSk);
        opLoft(context, id + "wing", {
            "profileSubqueries" : [qSketchRegion(id + "root"), qSketchRegion(id + "tip")]
        });
    });`,
};

const summaries = {
  "cambridge_text_to_design.md": `# Cambridge Design Society Paper

Source: https://www.cambridge.org/core/journals/proceedings-of-the-design-society/article/from-text-to-design-a-framework-to-leverage-llm-agents-for-automated-cAD-generation/5BD8D63CFCED28BDD7A01313162FFBE7

- Modeling patterns: LLM function calls generate CAD primitives and booleans inside agent workflows; step planning and visual inspection are the most relevant reusable patterns.
- Recommended primitives: block, cylinder, boolean addition/subtraction, and generated code for geometric calculation; for this repo, map those ideas to sketch + opExtrude, opRevolve, opLoft, opSweep, and opBoolean.
- Failure modes: spatial ambiguity, prompt dependency, hallucinated operations, and limited spatial reasoning; ask-back can distract when prompts are already specific.
- Example shapes: box, corner plate, U-profile, toy car, and FCRC bracket; visual inspection improved success more than plain step planning.
- Implementation notes: preserve conversation and function-call logs, record workflow selection, and use validation/repair loops before final CAD assembly.
`,
  "cad_mllm.md": `# CAD-MLLM

Source: https://github.com/CAD-MLLM/CAD-MLLM and https://cad-mllm.github.io/

- Modeling patterns: CAD commands are treated as structured sequences conditioned by text and visual inputs; useful repo mapping is prompt -> command plan -> FeatureScript sketches/operations.
- Recommended primitives: sequence-level sketch, extrusion, revolve, loft, and sweep patterns; retrieval snippets should describe operation order and profile geometry.
- Failure modes: multimodal shape understanding can fail when image-to-command alignment is weak; generated command sequences need closed sketches, valid constraints, and correct operation order.
- Example shapes: dataset-style CAD samples with sketches, extrudes, STEP-like geometry, and command histories; compact metadata is safer than importing raw archives into prompts.
- Implementation notes: add silhouette/profile descriptors, dataset-derived memory rows, adaptive reranking, and trace logs with retrieved rows and scores.
`,
  "deepcad.md": `# DeepCAD

Source: https://www.cs.columbia.edu/cg/deepcad

- Modeling patterns: DeepCAD represents CAD models as ordered sketch and extrude command sequences, which map directly to solved sketches followed by feature operations.
- Recommended primitives: sketch loops made of lines/arcs/circles, then extrude commands with distances and operations.
- Failure modes: raw command data can include unknown units, unsupported feature types, and non-closed loops; direct ingestion of full archives is too heavy for git.
- Example shapes: simple spacers, plates, prismatic bodies, and multi-extrude mechanical parts from JSON/H5 samples.
- Implementation notes: sample archives into compact cad_memory rows with curve counts, operation counts, and template hints rather than committing raw model data.
`,
  "omni_cad.md": `# Omni-CAD Dataset

Source: https://huggingface.co/datasets/jingwei-xu-00/Omni-CAD

- Modeling patterns: large multimodal CAD data can provide retrieval examples for command order, shape classification, and profile descriptors.
- Recommended primitives: use dataset examples as template hints for extrude, revolve, loft, sweep, shell, and boolean workflows.
- Failure modes: raw datasets are large, heterogeneous, and unsuitable for direct git storage; ingestion should be capped and metadata-only by default.
- Example shapes: dataset entries are converted into cad_memory snippets when extracted locally; zip-only archives are logged as available but skipped until extracted or sampled by tooling.
- Implementation notes: keep data/Omni-CAD.zip ignored and store compact summaries, training vectors, and high-quality FS templates in tracked files.
`,
  "onshape_doc.md": `# Onshape Document

Source: https://cad.onshape.com/documents/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/cc63f85d51cb344ad9ede672

- Modeling patterns: this source is a live Onshape document, so access may require account permissions; local FeatureScript docs are used as the reliable API reference.
- Recommended primitives: FeatureScript 2931 with geometry.fs import, editable preconditions, solved sketches, and standard operations.
- Failure modes: browser-only or permission-gated CAD documents cannot be used as unattended import sources; store reusable code snippets locally instead.
- Example shapes: use local FS examples for carrot revolve, loft transition, sweep elbow, shell enclosure, fillet/chamfer, hybrid flange, vase, and airfoil.
- Implementation notes: /agent/run logs generated code and can be pasted into Onshape for final compile verification.
`,
  "deployed_app.md": `# Deployed CAD-AI App

Source: https://cad-ai-0o9s.onrender.com

- Modeling patterns: the deployed API mirrors this repo's /generate, /debug, /learning/diagnostics, and new /agent/run workflow when current code is deployed.
- Recommended primitives: retrieval-augmented FeatureScript generation using local knowledge, pruning rules, memory rows, and FS docs.
- Failure modes: deployment may lag local code, database schema may be missing adaptive tables, and external LLM calls can rate-limit.
- Example shapes: smoke prompts cover organic revolve, loft transition, sweep elbow, shell enclosure, hybrid flange, and edge-case loft.
- Implementation notes: diagnostics and generation logs are written under logs/ for repeatable inspection.
`,
  "edge_open_tabs.md": `# Edge Open Tabs

Source: IDE context only

- No explicit edge_all_open_tabs URL list was available in the prompt beyond the named research URLs, deployed app, Onshape document, and local files.
- Local files inspected: data/cadKnowledge.csv, data/cadKnowledge.json, data/cadPruningTable.csv, adaptiveNetwork.js, AI.js, learning.js, server.js, and dataset archives under data/.
- Imported data includes DeepCAD-style cad_json/cad_vec archives and Omni-CAD.zip; raw archives are kept ignored and summarized into memory rows.
`,
};

function summarizeDeepCadJson(parsed, sampleId) {
  const entities = Object.values(parsed.entities || {});
  const sketches = entities.filter(e => e.type === "Sketch");
  const extrudes = entities.filter(e => e.type === "ExtrudeFeature");
  const curveCounts = {};
  let loopCount = 0;
  for (const sketch of sketches) {
    for (const profile of Object.values(sketch.profiles || {})) {
      for (const loop of profile.loops || []) {
        loopCount += 1;
        for (const curve of loop.profile_curves || []) {
          curveCounts[curve.type || "UnknownCurve"] = (curveCounts[curve.type || "UnknownCurve"] || 0) + 1;
        }
      }
    }
  }
  const curveSummary = Object.entries(curveCounts).map(([k, v]) => `${k}:${v}`).join(";");
  const dominant = curveCounts.Circle3D && curveCounts.Circle3D >= (curveCounts.Line3D || 0) ? "circular_profile" : "line_profile";
  return row({
    title: `DeepCAD Sample ${sampleId} ${dominant}`,
    summary: `Dataset sample with ${sketches.length} sketch(es), ${loopCount} loop(s), ${extrudes.length} extrude feature(s), and curves ${curveSummary || "none"}.`,
    tags: `dataset;deepcad;${dominant};sketch;extrude`,
    keywords: `DeepCAD;${sampleId};${Object.keys(curveCounts).join(";")};ExtrudeFeature;Sketch`,
    parameter_hints: "sampleId;sketchCount;loopCount;extrudeCount;curveTypes",
    modeling_notes: `Use as retrieval metadata, not raw geometry.;Curve counts: ${curveSummary || "none"}.;Convert closed loops to skRectangle, skCircle, skLineSegment, or skFitSpline where possible.`,
    feature_pattern: `${sketches.length} sketch(es) -> skSolve -> ${extrudes.length || 1} opExtrude operation(s); dominant=${dominant}.`,
    failure_modes: "unknown units;unsupported sketch curve;open profile",
    validation_rules: "closed loops before qSketchRegion;skSolve before opExtrude;raw dataset remains ignored",
    example_prompt: dominant === "circular_profile" ? "Create a parametric spacer or bushing from a circular dataset profile" : "Create a parametric prismatic plate from a rectangular dataset profile",
    shape_type: dominant === "circular_profile" ? "CYLINDER" : "BOX",
    memory_type: "dataset_example",
    quality_score: 0.78,
    source_table: "cad_memory",
    memory_only: true,
  });
}

function sampleDeepCadRows(limit = 36) {
  const archive = join(DATA, "data", "cad_json.tar.gz");
  if (!existsSync(archive)) return [];
  try {
    const entries = execFileSync("tar", ["-tf", archive], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter(name => name.endsWith(".json"))
      .slice(0, limit);
    const rows = [];
    for (const entry of entries) {
      try {
        const raw = execFileSync("tar", ["-xOf", archive, entry], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
        const parsed = JSON.parse(raw);
        rows.push(summarizeDeepCadJson(parsed, basename(entry, ".json")));
      } catch {
        continue;
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function fsMemoryRows() {
  return Object.entries(fsExamples).map(([file, code]) => row({
    title: `FeatureScript Example ${basename(file, ".fs").replace(/_/g, " ")}`,
    summary: `Compile-oriented FeatureScript template for ${basename(file, ".fs").replace(/_/g, " ")}.`,
    tags: `featurescript;example;${basename(file, ".fs").replace(/_/g, ";")}`,
    keywords: `${basename(file, ".fs").replace(/_/g, ";")};FeatureScript;skSolve;geometry.fs`,
    parameter_hints: "see precondition parameters in feature_pattern",
    modeling_notes: "Use as a local retrieval snippet.;Keep FeatureScript 2931 header and geometry import.;Preserve skSolve before downstream operations.",
    feature_pattern: code,
    failure_modes: "manual edits can break parameter exposure;operation-specific API changes",
    validation_rules: "FeatureScript 2931 header;geometry.fs 2931.0 import;exactly one export const;skSolve present",
    example_prompt: `Use the ${basename(file, ".fs").replace(/_/g, " ")} template`,
    shape_type: "CUSTOM",
    memory_type: "fs_example",
    quality_score: 0.9,
    source_table: "cad_memory",
    memory_only: true,
  }));
}

function vectorForIndex(index, target) {
  const phase = (index % 10) / 10;
  return [
    target ? 0.75 : 0.25,
    phase,
    target ? 0.88 : 0.18,
    target ? 1 : 0,
    target ? 0.82 : 0.1,
    target ? 0.08 : 0.9,
    target ? 0.7 : 0.45,
    0.65,
    Math.log1p(index + 1) / Math.log1p(100),
    target ? 0.78 : 0.95,
    0.8,
  ];
}

async function appendTrainingExamples(memoryRows) {
  const good = [...memoryRows, ...knowledgeRows].slice(0, 54).map((source, index) => ({
    vector: vectorForIndex(index, 1),
    target: 1,
    source: "research_import_dataset",
    title: source.title,
    timestamp: new Date().toISOString(),
  }));
  const bad = pruningRows.slice(0, 12).map((source, index) => ({
    vector: vectorForIndex(index, 0),
    target: 0,
    source: "research_import_failure_mode",
    title: source.title,
    timestamp: new Date().toISOString(),
  }));
  const lines = [...good, ...bad].map(item => JSON.stringify(item)).join("\n") + "\n";
  await appendFile(join(DATA, "adaptive_training.jsonl"), lines);
  return good.length + bad.length;
}

async function main() {
  await mkdir(DATA, { recursive: true });
  await mkdir(DOCS, { recursive: true });
  await mkdir(LOGS, { recursive: true });
  await mkdir(FS_DIR, { recursive: true });

  for (const [file, code] of Object.entries(fsExamples)) {
    await writeFile(join(FS_DIR, file), `${code.trim()}\n`);
  }
  for (const [file, text] of Object.entries(summaries)) {
    await writeFile(join(DOCS, file), text);
  }

  const datasetRows = sampleDeepCadRows(36);
  const memoryRows = [...fsMemoryRows(), ...datasetRows];
  await writeFile(join(DATA, "cadKnowledge.new.csv"), csv(knowledgeRows));
  await writeFile(join(DATA, "cadPruningTable.new.csv"), csv(pruningRows));
  await writeFile(join(DATA, "cadMemoryExamples.new.csv"), csv(memoryRows));
  await writeFile(join(DATA, "cadKnowledge.new.json"), JSON.stringify(knowledgeRows, null, 2));
  const trainingCount = await appendTrainingExamples(memoryRows);

  const metrics = {
    compile_success_rate: null,
    average_quality_score: Number((memoryRows.reduce((sum, r) => sum + Number(r.quality_score || 0), 0) / Math.max(memoryRows.length, 1)).toFixed(3)),
    pruning_rule_trigger_rate: null,
    adaptive_network_trained_steps: 0,
    generated_at: new Date().toISOString(),
  };
  await writeFile(join(LOGS, "metrics.json"), JSON.stringify(metrics, null, 2));
  await mkdir(join(ROOT, "public"), { recursive: true });
  await writeFile(join(ROOT, "public", "learning_dashboard.json"), JSON.stringify({
    ...metrics,
    knowledge_rows_ready: knowledgeRows.length,
    pruning_rules_ready: pruningRows.length,
    fs_examples_ready: Object.keys(fsExamples).length,
    dataset_memory_rows_ready: datasetRows.length,
    adaptive_training_rows_appended: trainingCount,
  }, null, 2));

  const summary = [
    "# CAD-MLLM Import Artifact Build",
    "",
    `- Knowledge rows: ${knowledgeRows.length}`,
    `- Pruning rules: ${pruningRows.length}`,
    `- FeatureScript examples: ${Object.keys(fsExamples).length}`,
    `- Dataset memory rows sampled: ${datasetRows.length}`,
    `- Adaptive training rows appended: ${trainingCount}`,
    `- Raw archives ignored: data/Omni-CAD.zip, data/data/*.tar.gz`,
    "",
  ].join("\n");
  await writeFile(join(LOGS, "cad_mllm_import_summary.md"), summary);
  console.log(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
