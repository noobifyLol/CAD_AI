import { existsSync, readFileSync } from "node:fs";

function cleanBase64(value = "") {
  const text = String(value || "").trim();
  const comma = text.indexOf(",");
  return comma >= 0 ? text.slice(comma + 1) : text;
}

function parsePng(buffer) {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return {
    format: "png",
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGif(buffer) {
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  return {
    format: "gif",
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
      return {
        format: "jpeg",
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function imageDescriptorFromBuffer(buffer) {
  const parsed = parsePng(buffer) || parseGif(buffer) || parseJpeg(buffer);
  if (!parsed) {
    return {
      modality: "image",
      format: "unknown",
      notes: ["Image bytes were present, but only header-level descriptors could be inferred."],
    };
  }

  const aspectRatio = parsed.height ? parsed.width / parsed.height : 1;
  const silhouetteClass = aspectRatio > 1.35
    ? "wide-profile"
    : aspectRatio < 0.75
      ? "tall-profile"
      : "balanced-profile";

  return {
    modality: "image",
    ...parsed,
    aspectRatio,
    silhouetteClass,
    boundingBox: { x: 0, y: 0, width: parsed.width, height: parsed.height },
    notes: [
      "Header-derived image descriptor; provide explicit imageFeatures for pixel-accurate silhouette control points.",
    ],
  };
}

function extractPromptControlPoints(prompt = "") {
  const percentages = [...String(prompt).matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map(match => Math.max(0, Math.min(1, Number(match[1]) / 100)));
  if (!percentages.length) return [];
  return percentages.map((station, index) => ({ station, index }));
}

function classifyShape(prompt = "", descriptors = []) {
  const text = String(prompt || "").toLowerCase();
  if (/\b(carrot|vase|bottle|revolve|lathe|silhouette|axisymmetric)\b/.test(text)) return "revolve_organic";
  if (/\b(loft|transition|airfoil|square to circle|circle to rectangle)\b/.test(text)) return "loft_transition";
  if (/\b(pipe|tube|elbow|sweep|duct|hose)\b/.test(text)) return "sweep_path";
  if (/\b(enclosure|housing|shell|open top|box)\b/.test(text)) return "shell_enclosure";
  if (/\b(flange|bolt circle|bolt holes|mounting)\b/.test(text)) return "mechanical_pattern";
  const tallImage = descriptors.some(item => item.silhouetteClass === "tall-profile");
  return tallImage ? "revolve_organic" : "custom";
}

function pointBounds(points) {
  if (!points.length) return null;
  const min = [...points[0]];
  const max = [...points[0]];
  for (const point of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], point[i]);
      max[i] = Math.max(max[i], point[i]);
    }
  }
  return {
    min,
    max,
    size: max.map((value, index) => value - min[index]),
  };
}

function parseStepPoints(text = "") {
  const points = [];
  const re = /CARTESIAN_POINT\s*\([^,]*,\s*\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)\s*\)/g;
  for (const match of String(text).matchAll(re)) {
    points.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    if (points.length >= 2000) break;
  }
  return points;
}

function parsePcdPoints(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const dataIndex = lines.findIndex(line => /^DATA\s+ascii/i.test(line.trim()));
  if (dataIndex < 0) return [];
  const points = [];
  for (const line of lines.slice(dataIndex + 1)) {
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      points.push(parts.slice(0, 3));
    }
    if (points.length >= 2000) break;
  }
  return points;
}

function descriptorFromPoints(modality, points) {
  const bounds = pointBounds(points);
  if (!bounds) return null;
  const [x, y, z] = bounds.size;
  const dominantAxis = x >= y && x >= z ? "x" : y >= z ? "y" : "z";
  return {
    modality,
    pointCount: points.length,
    boundingBox: bounds,
    dominantAxis,
    aspectHints: {
      slenderness: Math.max(x, y, z) / Math.max(1e-9, Math.min(x || 1e-9, y || 1e-9, z || 1e-9)),
    },
  };
}

function readMaybePath(value) {
  const path = String(value || "").trim();
  if (!path || !existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

export function conditionMultimodalInput(input = {}) {
  const prompt = String(input.prompt || "");
  const descriptors = [];

  const imageItems = [
    ...(Array.isArray(input.images) ? input.images : []),
    input.imageBase64 ? { imageBase64: input.imageBase64, label: input.imageLabel || "image" } : null,
  ].filter(Boolean);

  for (const image of imageItems.slice(0, 4)) {
    if (image.imageFeatures) {
      descriptors.push({ modality: "image", label: image.label || "image", ...image.imageFeatures });
      continue;
    }
    if (!image.imageBase64) continue;
    try {
      const buffer = Buffer.from(cleanBase64(image.imageBase64), "base64");
      descriptors.push({ label: image.label || "image", ...imageDescriptorFromBuffer(buffer) });
    } catch (err) {
      descriptors.push({ modality: "image", label: image.label || "image", error: err.message });
    }
  }

  const stepText = input.stepText || readMaybePath(input.stepPath);
  if (stepText) {
    const stepDescriptor = descriptorFromPoints("step", parseStepPoints(stepText));
    if (stepDescriptor) descriptors.push(stepDescriptor);
  }

  const pcdText = input.pcdText || readMaybePath(input.pcdPath);
  if (pcdText) {
    const pcdDescriptor = descriptorFromPoints("pcd", parsePcdPoints(pcdText));
    if (pcdDescriptor) descriptors.push(pcdDescriptor);
  }

  const controlPoints = Array.isArray(input.controlPoints) && input.controlPoints.length
    ? input.controlPoints
    : extractPromptControlPoints(prompt);

  const shapeClass = classifyShape(prompt, descriptors);
  return {
    shapeClass,
    controlPoints,
    descriptors,
    plannerHints: [
      controlPoints.length ? `Use ${controlPoints.length} prompt-derived control point stations.` : "",
      descriptors.some(item => item.modality === "step") ? "STEP bounding box available for parameter extraction." : "",
      descriptors.some(item => item.modality === "pcd") ? "PCD point bounds available for dominant-axis planning." : "",
      descriptors.some(item => item.modality === "image") ? "Image descriptor available for silhouette conditioning." : "",
    ].filter(Boolean),
  };
}

export function extractMultimodalConditioning(input = {}) {
  const conditioned = conditionMultimodalInput(input);
  const descriptorSummary = conditioned.descriptors
    .map(item => {
      const label = item.label ? `${item.label}:` : "";
      const shape = item.silhouetteClass || item.dominantAxis || item.modality || "descriptor";
      return `${label}${shape}`;
    })
    .join("; ");
  return {
    ...conditioned,
    hasMultimodalInput: conditioned.descriptors.length > 0 || conditioned.controlPoints.length > 0,
    summary: [
      conditioned.shapeClass ? `shapeClass=${conditioned.shapeClass}` : "",
      descriptorSummary,
      conditioned.controlPoints.length ? `controlPoints=${conditioned.controlPoints.length}` : "",
      ...(conditioned.plannerHints || []),
    ].filter(Boolean).join(" | "),
  };
}
