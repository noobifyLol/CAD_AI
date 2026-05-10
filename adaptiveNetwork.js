const INPUT_SIZE = 11;
const HIDDEN_LAYERS = [14, 10, 6];
const NETWORK_KEY = "retrieval_reranker";

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** 
 * Advanced Math: LeakyReLU activation function
 * Hidden layers use this. Final output layer uses Sigmoid for a clean 0-1 score.
 * Backprop uses leakyReLUDeriv for hidden layers and sigmoidDeriv for output.
 */
function leakyReLU(x) {
  return x > 0 ? x : x * 0.01;
}

function seededWeight(layerIndex, rowIndex, colIndex) {
  const seed = Math.sin((layerIndex + 1) * 1009 + (rowIndex + 1) * 97 + (colIndex + 1) * 17);
  return Number((seed * 0.18).toFixed(8));
}

function makeLayer(inputSize, outputSize, layerIndex) {
  return {
    weights: Array.from({ length: outputSize }, (_, row) =>
      Array.from({ length: inputSize }, (_, col) => seededWeight(layerIndex, row, col))
    ),
    biases: Array.from({ length: outputSize }, (_, row) => seededWeight(layerIndex, row, inputSize) * 0.2),
  };
}

export function createInitialAdaptiveState() {
  const sizes = [INPUT_SIZE, ...HIDDEN_LAYERS, 1];
  return {
    version: 1,
    key: NETWORK_KEY,
    inputSize: INPUT_SIZE,
    hiddenLayers: HIDDEN_LAYERS,
    learningRate: 0.035,
    trainedSteps: 0,
    layers: sizes.slice(1).map((size, index) => makeLayer(sizes[index], size, index)),
  };
}

function normalizeState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.layers)) {
    return createInitialAdaptiveState();
  }
  return {
    ...createInitialAdaptiveState(),
    ...state,
    inputSize: INPUT_SIZE,
    hiddenLayers: HIDDEN_LAYERS,
  };
}

function sourceScore(sourceKind) {
  return {
    memory: 1,
    example: 0.78,
    knowledge: 0.62,
    shape: 0.58,
    docs: 0.5,
    local: 0.42,
  }[sourceKind] ?? 0.5;
}

function textFields(candidate) {
  return [
    candidate.title,
    candidate.summary,
    candidate.prompt,
    candidate.shape_type,
    candidate.thinking,
    candidate.feature_pattern,
    candidate.text,
    ...(candidate.tags || []),
    ...(candidate.keywords || []),
    ...(candidate.parameter_hints || candidate.parameterHints || []),
    ...(candidate.modeling_notes || candidate.modelingNotes || []),
    ...(candidate.failure_modes || candidate.failureModes || []),
    ...(candidate.validation_rules || candidate.validationRules || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function keywordOverlap(candidate, context) {
  const keywords = Array.isArray(context.keywords) ? context.keywords : [];
  if (!keywords.length) return 0;
  const haystack = textFields(candidate);
  const matched = keywords.filter(keyword => haystack.includes(String(keyword).toLowerCase())).length;
  return matched / keywords.length;
}

function recencyScore(candidate) {
  if (!candidate.created_at) return 0.45;
  const created = new Date(candidate.created_at).getTime();
  if (!Number.isFinite(created)) return 0.45;
  const days = Math.max(0, (Date.now() - created) / 86400000);
  return Math.exp(-days / 45);
}

function qualityScore(candidate) {
  if (Number.isFinite(Number(candidate.quality_score))) return clamp(candidate.quality_score);
  if (Number.isFinite(Number(candidate.user_rating))) return clamp(candidate.user_rating / 5);
  return 0.5;
}

function successScore(candidate) {
  const success = Number(candidate.success_count || 0);
  const failure = Number(candidate.failure_count || 0);
  const total = success + failure;
  return total > 0 ? success / total : 0.5;
}

function failureScore(candidate) {
  const success = Number(candidate.success_count || 0);
  const failure = Number(candidate.failure_count || 0);
  const total = success + failure;
  return total > 0 ? failure / total : 0;
}

function hasPattern(candidate) {
  return Boolean(candidate.feature_pattern || candidate.featurescript || candidate.text);
}

function heuristicScore(candidate) {
  return clamp(Math.tanh(Number(candidate._score || candidate.match_score || 0) / 8));
}

export function candidateFeatureVector(candidate, context = {}, sourceKind = "memory") {
  const shapeHint = context.shapeHint;
  const shapeMatch = shapeHint && candidate.shape_type === shapeHint ? 1 : 0;
  const usage = Math.log1p(Number(candidate.usage_count || 0)) / Math.log1p(100);
  const hasFailures = Array.isArray(candidate.failure_modes || candidate.failureModes)
    && (candidate.failure_modes || candidate.failureModes).length > 0;

  return [
    heuristicScore(candidate),
    keywordOverlap(candidate, context),
    shapeMatch,
    qualityScore(candidate),
    sourceScore(sourceKind),
    successScore(candidate),
    failureScore(candidate),
    clamp(usage),
    recencyScore(candidate),
    hasPattern(candidate) ? 1 : 0,
    hasFailures ? 0.75 : 0,
  ].map(value => clamp(value));
}

export function forwardAdaptiveNetwork(rawState, input) {
  const state = normalizeState(rawState);
  let activation = input.slice(0, INPUT_SIZE).map(value => clamp(value));

  for (const layer of state.layers) {
    activation = layer.weights.map((weights, row) => {
      const z = weights.reduce((sum, weight, col) => sum + weight * activation[col], layer.biases[row] || 0);
      return leakyReLU(z);
    });
  }

  return activation[0] ?? 0.5;
}

export function rerankCandidates(rawState, candidates, context = {}, sourceKind = "memory", limit = candidates.length) {
  const state = normalizeState(rawState);
  return [...candidates]
    .map(candidate => {
      const featureVector = candidateFeatureVector(candidate, context, sourceKind);
      const neuralScore = forwardAdaptiveNetwork(state, featureVector);
      const combinedScore = neuralScore * 0.68 + heuristicScore(candidate) * 0.32;
      return {
        ...candidate,
        _sourceKind: sourceKind,
        _featureVector: featureVector,
        _neuralScore: neuralScore,
        _combinedScore: combinedScore,
      };
    })
    .sort((a, b) => b._combinedScore - a._combinedScore)
    .slice(0, limit);
}

function cloneState(rawState) {
  const state = normalizeState(rawState);
  return JSON.parse(JSON.stringify(state));
}

// LeakyReLU derivative — must match the activation used in forwardAdaptiveNetwork
function leakyReLUDeriv(z) {
  return z > 0 ? 1 : 0.01;
}

// Sigmoid is kept for the FINAL output neuron only (squashes output to 0–1)
function sigmoid(x) {
  if (x < -40) return 0;
  if (x > 40) return 1;
  return 1 / (1 + Math.exp(-x));
}

function sigmoidDeriv(activated) {
  return activated * (1 - activated);
}

function forwardWithTrace(state, input) {
  const activations = [input.slice(0, INPUT_SIZE).map(value => clamp(value))];
  const zs = [];

  const lastLayerIndex = state.layers.length - 1;
  for (let li = 0; li < state.layers.length; li++) {
    const layer = state.layers[li];
    const prev = activations[activations.length - 1];
    const z = layer.weights.map((weights, row) =>
      weights.reduce((sum, weight, col) => sum + weight * prev[col], layer.biases[row] || 0)
    );
    zs.push(z);
    // Hidden layers use LeakyReLU; output layer uses Sigmoid for bounded 0-1 score
    const activate = li === lastLayerIndex ? sigmoid : leakyReLU;
    activations.push(z.map(activate));
  }

  return { activations, zs };
}

function trainOne(state, featureVector, target, strength) {
  const { activations, zs } = forwardWithTrace(state, featureVector);
  const deltas = new Array(state.layers.length);
  const last = state.layers.length - 1;
  const output = activations[activations.length - 1][0];

  // Output layer: sigmoid derivative (d/dz sigmoid(z) = sigmoid(z)*(1-sigmoid(z)))
  deltas[last] = [(output - target) * sigmoidDeriv(output) * strength];

  for (let layerIndex = last - 1; layerIndex >= 0; layerIndex--) {
    const nextLayer = state.layers[layerIndex + 1];
    deltas[layerIndex] = zs[layerIndex].map((z, row) => {
      const downstream = nextLayer.weights.reduce((sum, weights, nextRow) => {
        return sum + weights[row] * deltas[layerIndex + 1][nextRow];
      }, 0);
      // Hidden layers: LeakyReLU derivative applied to pre-activation z
      return downstream * leakyReLUDeriv(z);
    });
  }

  const rate = Number(state.learningRate || 0.035);
  for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex++) {
    const layer = state.layers[layerIndex];
    const prevActivation = activations[layerIndex];
    for (let row = 0; row < layer.weights.length; row++) {
      for (let col = 0; col < layer.weights[row].length; col++) {
        layer.weights[row][col] -= rate * deltas[layerIndex][row] * prevActivation[col];
      }
      layer.biases[row] -= rate * deltas[layerIndex][row];
    }
  }
}

export function trainAdaptiveState(rawState, featureVectors, target, strength = 1) {
  const state = cloneState(rawState);
  const cleanTarget = clamp(target);
  const cleanStrength = clamp(strength, 0.1, 2);

  for (const vector of featureVectors) {
    if (!Array.isArray(vector) || vector.length !== INPUT_SIZE) continue;
    trainOne(state, vector, cleanTarget, cleanStrength);
    state.trainedSteps += 1;
  }

  state.updatedAt = new Date().toISOString();
  return state;
}

export function feedbackTarget(signal, rating) {
  if (Number.isFinite(Number(rating))) return clamp((Number(rating) - 1) / 4);
  return ["good", "helpful", "copied"].includes(signal) ? 0.9 : 0.12;
}

export function feedbackStrength(weight) {
  return clamp(Math.abs(Number(weight || 0)) * 8, 0.25, 1.5);
}

export const ADAPTIVE_NETWORK_KEY = NETWORK_KEY;