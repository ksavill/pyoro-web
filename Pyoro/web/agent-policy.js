export const POLICY_MODEL_FORMAT = "pyoro-policy-v1";

export const ACTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 0,
    key: "idle",
    label: "Idle",
    horizontal: 0,
    abilityHeld: false,
  }),
  Object.freeze({
    id: 1,
    key: "left",
    label: "Left",
    horizontal: -1,
    abilityHeld: false,
  }),
  Object.freeze({
    id: 2,
    key: "right",
    label: "Right",
    horizontal: 1,
    abilityHeld: false,
  }),
  Object.freeze({
    id: 3,
    key: "ability",
    label: "Ability",
    horizontal: 0,
    abilityHeld: true,
  }),
  Object.freeze({
    id: 4,
    key: "leftAbility",
    label: "Left + Ability",
    horizontal: -1,
    abilityHeld: true,
  }),
  Object.freeze({
    id: 5,
    key: "rightAbility",
    label: "Right + Ability",
    horizontal: 1,
    abilityHeld: true,
  }),
]);

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
}

function dotProduct(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

export function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - maxLogit));
  const total = exps.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || !Number.isFinite(total)) {
    return logits.map((_value, index) => (index === 0 ? 1 : 0));
  }
  return exps.map((value) => value / total);
}

export function sampleSoftmax(probabilities, random = Math.random) {
  const roll = random();
  let cumulative = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    cumulative += probabilities[index];
    if (roll <= cumulative) {
      return index;
    }
  }
  return probabilities.length - 1;
}

export function argmax(values) {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function validatePolicyModel(model, expectedObservationSize = null) {
  if (!model || typeof model !== "object") {
    throw new Error("Policy model must be an object.");
  }

  if (model.format !== POLICY_MODEL_FORMAT) {
    throw new Error(`Unsupported policy model format: ${String(model.format)}`);
  }

  if (!Number.isInteger(model.observationSize) || model.observationSize <= 0) {
    throw new Error("Policy model observationSize must be a positive integer.");
  }

  if (expectedObservationSize !== null && model.observationSize !== expectedObservationSize) {
    throw new Error(
      `Policy model observation size ${model.observationSize} does not match expected size ${expectedObservationSize}.`,
    );
  }

  if (!Number.isInteger(model.actionSize) || model.actionSize !== ACTION_DEFINITIONS.length) {
    throw new Error(
      `Policy model actionSize must be ${ACTION_DEFINITIONS.length}.`,
    );
  }

  assertArray(model.layers, "Policy model layers");
  if (!model.layers.length) {
    throw new Error("Policy model must contain at least one layer.");
  }

  let inputSize = model.observationSize;
  model.layers.forEach((layer, index) => {
    if (!layer || typeof layer !== "object") {
      throw new Error(`Layer ${index} must be an object.`);
    }
    if (!Number.isInteger(layer.inputSize) || layer.inputSize !== inputSize) {
      throw new Error(`Layer ${index} inputSize must equal ${inputSize}.`);
    }
    if (!Number.isInteger(layer.outputSize) || layer.outputSize <= 0) {
      throw new Error(`Layer ${index} outputSize must be a positive integer.`);
    }
    if (!["relu", "linear"].includes(layer.activation)) {
      throw new Error(`Layer ${index} activation must be "relu" or "linear".`);
    }

    assertArray(layer.weights, `Layer ${index} weights`);
    assertArray(layer.biases, `Layer ${index} biases`);

    if (layer.weights.length !== layer.outputSize) {
      throw new Error(`Layer ${index} weights row count must equal outputSize.`);
    }
    if (layer.biases.length !== layer.outputSize) {
      throw new Error(`Layer ${index} bias count must equal outputSize.`);
    }

    for (let rowIndex = 0; rowIndex < layer.weights.length; rowIndex += 1) {
      const row = layer.weights[rowIndex];
      assertArray(row, `Layer ${index} weights[${rowIndex}]`);
      if (row.length !== layer.inputSize) {
        throw new Error(`Layer ${index} weights[${rowIndex}] must contain ${layer.inputSize} values.`);
      }
    }

    inputSize = layer.outputSize;
  });

  if (inputSize !== model.actionSize) {
    throw new Error("Policy model final layer output size must match actionSize.");
  }

  return model;
}

export function inferPolicyLogits(model, observation) {
  validatePolicyModel(model, observation.length);

  let activations = observation;
  for (const layer of model.layers) {
    const outputs = new Array(layer.outputSize);
    for (let rowIndex = 0; rowIndex < layer.outputSize; rowIndex += 1) {
      let value = dotProduct(layer.weights[rowIndex], activations) + layer.biases[rowIndex];
      if (layer.activation === "relu") {
        value = Math.max(0, value);
      }
      outputs[rowIndex] = value;
    }
    activations = outputs;
  }
  return activations;
}

export function selectGreedyAction(model, observation) {
  return argmax(inferPolicyLogits(model, observation));
}

export async function loadPolicyModelFromUrl(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load policy model from ${url}`);
  }

  const model = await response.json();
  return validatePolicyModel(model);
}

export function createPolicyModel({
  modeKey,
  observationSize,
  layers,
  metadata = {},
}) {
  if (!Number.isInteger(observationSize) || observationSize <= 0) {
    throw new Error("observationSize must be a positive integer.");
  }

  assertArray(layers, "layers");

  return validatePolicyModel({
    format: POLICY_MODEL_FORMAT,
    modeKey,
    observationSize,
    actionSize: ACTION_DEFINITIONS.length,
    actions: ACTION_DEFINITIONS.map((action) => action.key),
    layers,
    metadata,
  });
}

export function createLinearPolicyModel({
  modeKey,
  observationSize,
  weights,
  biases,
  metadata = {},
}) {
  assertArray(weights, "weights");
  assertArray(biases, "biases");

  if (weights.length !== ACTION_DEFINITIONS.length) {
    throw new Error(`weights must contain ${ACTION_DEFINITIONS.length} rows.`);
  }
  if (biases.length !== ACTION_DEFINITIONS.length) {
    throw new Error(`biases must contain ${ACTION_DEFINITIONS.length} values.`);
  }

  return createPolicyModel({
    modeKey,
    observationSize,
    metadata,
    layers: [
      {
        inputSize: observationSize,
        outputSize: ACTION_DEFINITIONS.length,
        activation: "linear",
        weights,
        biases,
      },
    ],
  });
}
