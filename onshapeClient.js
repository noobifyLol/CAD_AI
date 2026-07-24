/**
 * onshapeClient.js — real FeatureScript compile checks against a live Onshape document.
 *
 * Uses the classic Onshape API-key HMAC-SHA256 auth scheme (no OAuth/browser needed —
 * ONSHAPE_ACCESS_KEY/ONSHAPE_SECRET_KEY are a standing server-to-server credential from
 * https://dev.onshape.com/keys). Compilation is checked via the Part Studio "execute
 * featurescript" scratchpad endpoint, which evaluates a script against the studio's
 * already-imported context and returns real compiler notices (errors/warnings) without
 * writing anything back to the document — confirmed stateless: the response's
 * sourceMicroversion does not change across calls.
 *
 * This is intentionally a headless approximation, not a full feature-add: generated
 * candidates are "generate a whole part from scratch" style (isLength/isInteger/boolean
 * parameters only), so precondition parameters are faked with dummy values and the
 * precondition block itself is dropped. Query/enum-typed parameters can't be safely
 * faked, so those candidates are skipped (fail-open) rather than risk false positives.
 */

import crypto from "node:crypto";
import https from "node:https";

const ACCESS_KEY = String(process.env.ONSHAPE_ACCESS_KEY || "").trim();
const SECRET_KEY = String(process.env.ONSHAPE_SECRET_KEY || "").trim();
const TEST_DOCUMENT_ID = String(process.env.ONSHAPE_TEST_DOCUMENT_ID || "").trim();
const TEST_WORKSPACE_ID = String(process.env.ONSHAPE_TEST_WORKSPACE_ID || "").trim();
const TEST_PARTSTUDIO_ID = String(process.env.ONSHAPE_TEST_PARTSTUDIO_ID || "").trim();
const COMPILE_CHECK_ENABLED = String(process.env.ONSHAPE_COMPILE_CHECK_ENABLED || "true").toLowerCase() !== "false";
const REQUEST_TIMEOUT_MS = Number(process.env.ONSHAPE_REQUEST_TIMEOUT_MS || 15000);

export function isOnshapeConfigured() {
  return Boolean(
    COMPILE_CHECK_ENABLED && ACCESS_KEY && SECRET_KEY && TEST_DOCUMENT_ID && TEST_WORKSPACE_ID && TEST_PARTSTUDIO_ID
  );
}

function signedRequest(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const nonce = crypto.randomBytes(16).toString("hex").slice(0, 25);
    const authDate = new Date().toUTCString();
    const contentType = "application/json";
    const urlPath = path.split("?")[0];
    const urlQuery = path.includes("?") ? path.split("?")[1] : "";

    const stringToSign = (
      `${method}\n${nonce}\n${authDate}\n${contentType}\n${urlPath}\n${urlQuery}\n`
    ).toLowerCase();

    const hmac = crypto.createHmac("sha256", SECRET_KEY).update(stringToSign).digest("base64");
    const authorization = `On ${ACCESS_KEY}:HmacSHA256:${hmac}`;
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : undefined;

    const req = https.request(
      {
        hostname: "cad.onshape.com",
        path,
        method,
        headers: {
          Date: authDate,
          "On-Nonce": nonce,
          "Content-Type": contentType,
          Accept: "application/json",
          Authorization: authorization,
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Onshape request timed out")));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Locates `defineFeature(function(context is Context, id is Id, definition is map) [precondition {...}] {...})`
// and splits it into the precondition block (if present) and the body block via brace matching.
function extractFeatureBlocks(code) {
  const anchor = /function\s*\(\s*context\s+is\s+Context\s*,\s*id\s+is\s+Id\s*,\s*definition\s+is\s+map\s*\)/;
  const match = anchor.exec(code);
  if (!match) return null;

  function readBlock(fromIndex) {
    const start = code.indexOf("{", fromIndex);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < code.length; i += 1) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") {
        depth -= 1;
        if (depth === 0) return { start, end: i, content: code.slice(start + 1, i) };
      }
    }
    return null;
  }

  const afterParams = match.index + match[0].length;
  const first = readBlock(afterParams);
  if (!first) return null;

  const between = code.slice(afterParams, first.start).trim();
  if (/^precondition$/.test(between)) {
    const second = readBlock(first.end + 1);
    if (!second) return null;
    return { precondition: first.content, body: second.content };
  }
  return { precondition: "", body: first.content };
}

// Infers a safe dummy value for every `definition.X` reference. Returns null (bail out)
// if any reference can't be confidently typed — false positives are worse than skipping.
function inferDummyDeclarations(precondition, body) {
  const combined = `${precondition}\n${body}`;
  const names = new Set();
  const refRegex = /definition\s*\.\s*([A-Za-z_]\w*)/g;
  let m;
  while ((m = refRegex.exec(combined))) names.add(m[1]);

  const decls = [];
  for (const name of names) {
    const isBoolDecl = new RegExp(`definition\\s*\\.\\s*${name}\\s+is\\s+boolean\\b`).test(combined);
    const isLengthDecl = new RegExp(`isLength\\s*\\(\\s*definition\\s*\\.\\s*${name}\\b`).test(combined);
    const isIntegerDecl = new RegExp(
      `isInteger\\s*\\(\\s*definition\\s*\\.\\s*${name}\\b|definition\\s*\\.\\s*${name}\\s+is\\s+integer\\b`
    ).test(combined);
    // Standard "optional reference plane/entity" pattern taught by the system prompt:
    // `definition.X is Query;` guarded by `isQueryEmpty(context, definition.X)` with a
    // fallback default. Safe to fake with an empty query — the fallback path handles it.
    const isQueryDecl = new RegExp(`definition\\s*\\.\\s*${name}\\s+is\\s+Query\\b`).test(combined);
    const isEmptyGuarded = new RegExp(`isQueryEmpty\\s*\\(\\s*context\\s*,\\s*(?:definition\\s*\\.\\s*)?${name}\\b`).test(combined);

    if (isBoolDecl) {
      decls.push(`var _fake_${name} = true;`);
    } else if (isLengthDecl) {
      // Use the parameter's declared default from its bounds triple, exactly like the
      // Onshape dialog would. Uniform dummy values (all params = 1 inch) previously
      // degenerated real geometry (e.g. rimRadius - rimThickness = 0) and produced
      // false PARAMETER_OUT_OF_RANGE failures for perfectly valid features.
      const lengthBounds = new RegExp(
        `isLength\\s*\\(\\s*definition\\s*\\.\\s*${name}\\s*,\\s*\\{\\s*\\(inch\\)\\s*:\\s*\\[([^\\]]+)\\]`
      ).exec(combined);
      const lengthTriple = lengthBounds ? lengthBounds[1].split(",").map(v => Number(v.trim())) : null;
      const lengthDefault = lengthTriple && lengthTriple.length === 3 && Number.isFinite(lengthTriple[1]) ? lengthTriple[1] : 1;
      decls.push(`var _fake_${name} = ${lengthDefault} * inch;`);
    } else if (isIntegerDecl) {
      const integerBounds = new RegExp(
        `isInteger\\s*\\(\\s*definition\\s*\\.\\s*${name}\\s*,\\s*\\{\\s*\\(unitless\\)\\s*:\\s*\\[([^\\]]+)\\]`
      ).exec(combined);
      const integerTriple = integerBounds ? integerBounds[1].split(",").map(v => Number(v.trim())) : null;
      const integerDefault = integerTriple && integerTriple.length === 3 && Number.isFinite(integerTriple[1]) ? integerTriple[1] : 3;
      decls.push(`var _fake_${name} = ${integerDefault};`);
    } else if (isQueryDecl && isEmptyGuarded) {
      decls.push(`var _fake_${name} = qNothing();`);
    } else {
      return null; // Un-guarded Query, enum, or unrecognized shape — can't fake this safely.
    }
  }
  return { decls, names };
}

export function buildTestHarnessScript(fullModuleCode) {
  const blocks = extractFeatureBlocks(fullModuleCode);
  if (!blocks) {
    return { ok: false, reason: "Could not locate a defineFeature(function(context is Context, id is Id, definition is map) ...) block." };
  }

  const inferred = inferDummyDeclarations(blocks.precondition, blocks.body);
  if (!inferred) {
    return { ok: false, reason: "Feature has a Query/enum-typed parameter that can't be safely faked for a headless check." };
  }

  // Substitute with a reserved prefix so faked parameters can never collide with
  // variables the feature body itself declares (e.g. `var pitchRadius =
  // definition.pitchRadius;` must not become a duplicate declaration).
  let body = blocks.body;
  for (const name of inferred.names) {
    body = body.replace(new RegExp(`definition\\s*\\.\\s*${name}\\b`, "g"), `_fake_${name}`);
  }

  const script = [
    "function(context is Context, queries) {",
    '  var id = makeId("aiTestHarness");',
    ...inferred.decls.map((d) => `  ${d}`),
    body,
    '  return "ok";',
    "}",
  ].join("\n");

  return { ok: true, script };
}

// Tests one FeatureScript candidate against the real Onshape compiler.
// Always fail-open: any misconfiguration, unsupported shape, or network problem
// resolves with ok:null (skipped) rather than throwing, so callers can safely fall
// back to local-only validation.
export async function testCompileFeatureScript(code) {
  if (!isOnshapeConfigured()) {
    return { attempted: false, ok: null, errors: [], warnings: [], skippedReason: "Onshape compile check not configured." };
  }

  const harness = buildTestHarnessScript(code);
  if (!harness.ok) {
    return { attempted: false, ok: null, errors: [], warnings: [], skippedReason: harness.reason };
  }

  try {
    const path = `/api/partstudios/d/${TEST_DOCUMENT_ID}/w/${TEST_WORKSPACE_ID}/e/${TEST_PARTSTUDIO_ID}/featurescript`;
    const result = await signedRequest("POST", path, { script: harness.script });
    if (result.status !== 200) {
      return { attempted: true, ok: null, errors: [], warnings: [], skippedReason: `Onshape returned HTTP ${result.status}: ${result.body.slice(0, 300)}` };
    }

    const parsed = JSON.parse(result.body);
    const notices = Array.isArray(parsed.notices) ? parsed.notices : [];
    const errors = [];
    const warnings = [];
    const seen = new Set();

    for (const notice of notices) {
      const msg = notice?.message;
      if (!msg?.message) continue;
      const key = `${msg.level}:${msg.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = { message: msg.message, level: msg.level, type: msg.type };
      if (msg.level === "ERROR") errors.push(entry);
      else warnings.push(entry);
    }

    return { attempted: true, ok: errors.length === 0, errors, warnings, script: harness.script };
  } catch (err) {
    return { attempted: true, ok: null, errors: [], warnings: [], skippedReason: `Onshape request failed: ${err.message}` };
  }
}
