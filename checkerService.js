/**
 * checkerService.js: where the remote build-check service is (fs_sim/modal_app.py on Modal:
 * POST /build = FS-Lite test build, POST /simulate = Onshape-library simulator).
 *
 * FS_SIM_URL / FS_SIM_TOKEN set it explicitly. Without them it is derived from the DeepCAD
 * model settings the site already has: both services are deployed to the same Modal
 * workspace (…--cad-ai-text2cad-web.modal.run -> …--cad-ai-fs-sim-web.modal.run) and the
 * checker service also accepts the DeepCAD service's token. So a host that has
 * DEEPCAD_MODEL_URL and DEEPCAD_MODEL_TOKEN gets build checks with no extra settings.
 */
const clean = value => String(value || "").trim().replace(/\/+$/, "");

export const explicitCheckerUrl = clean(process.env.FS_SIM_URL);

const deepcadUrl = clean(process.env.DEEPCAD_MODEL_URL);
export const derivedCheckerUrl = /--cad-ai-text2cad-web\./.test(deepcadUrl) && String(process.env.FS_SIM_DERIVE || "true").toLowerCase() !== "false"
  ? deepcadUrl.replace("--cad-ai-text2cad-web.", "--cad-ai-fs-sim-web.")
  : "";

export const checkerUrl = explicitCheckerUrl || derivedCheckerUrl;
export const checkerToken = String(process.env.FS_SIM_TOKEN || process.env.DEEPCAD_MODEL_TOKEN || "").trim();

export function checkerHeaders() {
  return { "Content-Type": "application/json", ...(checkerToken ? { Authorization: `Bearer ${checkerToken}` } : {}) };
}
