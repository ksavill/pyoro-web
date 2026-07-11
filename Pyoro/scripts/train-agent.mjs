import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_DEFINITIONS,
  createPolicyModel,
  sampleSoftmax,
  softmax,
} from "../web/agent-policy.js";
import { PyoroHeadlessEnv } from "../web/headless-env.js";
import { heuristicActionForGame } from "../web/heuristic-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      continue;
    }

    const key = part.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, "true");
      continue;
    }

    options.set(key, next);
    index += 1;
  }
  return options;
}

function parseMode(value) {
  return value === "1" || value === "pyoro2" ? "pyoro2" : "pyoro1";
}

function parseIntOption(options, key, fallback) {
  const value = Number.parseInt(options.get(key) ?? "", 10);
  return Number.isInteger(value) ? value : fallback;
}

function parseFloatOption(options, key, fallback) {
  const value = Number.parseFloat(options.get(key) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function parseIntListOption(options, key, fallback) {
  const raw = options.get(key);
  if (!raw) {
    return fallback;
  }

  const values = raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return values.length ? values : fallback;
}

function createSeededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createMatrix(rowCount, columnCount, fill = 0) {
  return Array.from({ length: rowCount }, () => Array(columnCount).fill(fill));
}

function discountedReturns(rewards, gamma) {
  const returns = new Array(rewards.length);
  let running = 0;
  for (let index = rewards.length - 1; index >= 0; index -= 1) {
    running = rewards[index] + gamma * running;
    returns[index] = running;
  }
  return returns;
}

function standardize(values) {
  if (!values.length) {
    return values;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const deviation = Math.sqrt(Math.max(variance, 1e-8));
  return values.map((value) => (value - mean) / deviation);
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function shuffleInPlace(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const tmp = values[index];
    values[index] = values[swapIndex];
    values[swapIndex] = tmp;
  }
}

function buildEvalSeeds(config) {
  return Array.from(
    { length: config.evalEpisodes },
    (_unused, index) => config.seed + 100000 + index * 997,
  );
}

function buildTrainingSeeds(config, iteration) {
  return Array.from(
    { length: config.batchEpisodes },
    (_unused, index) => config.seed + iteration * 10007 + index * 37,
  );
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function interpolationFactor(iteration, totalIterations) {
  if (totalIterations <= 1) {
    return 1;
  }
  return iteration / (totalIterations - 1);
}

function interpolate(start, end, progress) {
  return start + (end - start) * progress;
}

function heuristicMixForIteration(config, iteration) {
  return interpolate(
    config.heuristicMixStart,
    config.heuristicMixEnd,
    interpolationFactor(iteration, config.iterations),
  );
}

function buildCollapseWarnings(metrics) {
  const warnings = [];
  if (metrics.dominantActionFraction >= 0.75) {
    warnings.push("dominant_action");
  }
  if (
    (metrics.dominantActionKey === "left" || metrics.dominantActionKey === "right")
    && metrics.dominantActionFraction >= 0.65
  ) {
    warnings.push("one_direction_bias");
  }
  if (metrics.averageEdgeHugRate >= 0.55) {
    warnings.push("edge_hugging");
  }
  if (metrics.averageIdleRate >= 0.6) {
    warnings.push("idle_heavy");
  }
  if (metrics.maxLongestSameActionStreak >= 240) {
    warnings.push("long_same_action_streak");
  }
  if (metrics.averageHeuristicAgreementRate <= 0.3) {
    warnings.push("low_heuristic_agreement");
  }
  return warnings;
}

function qualityScore(metrics) {
  let score = 0;
  score += metrics.averageScore;
  score += metrics.medianScore * 0.35;
  score += metrics.averageAvailableTileFraction * 140;
  score += metrics.averageMinimumAvailableTileFraction * 80;
  score += metrics.averageHeuristicAgreementRate * 120;
  score -= metrics.zeroScoreRate * 220;
  score -= Math.max(0, metrics.dominantActionFraction - 0.45) * 420;
  score -= Math.max(0, metrics.averageEdgeHugRate - 0.35) * 220;
  score -= Math.max(0, metrics.averageIdleRate - 0.35) * 220;
  score -= Math.max(0, metrics.maxLongestSameActionStreak - 120) * 0.45;
  return score;
}

function compareMetrics(left, right) {
  const delta = qualityScore(left) - qualityScore(right);
  if (delta !== 0) {
    return delta;
  }
  return left.averageReward - right.averageReward;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildActionWeights(actionCounts, config) {
  const nonZeroCounts = actionCounts.filter((count) => count > 0);
  if (!nonZeroCounts.length) {
    return Array(ACTION_DEFINITIONS.length).fill(1);
  }

  const baselineCount = average(nonZeroCounts);
  return actionCounts.map((count) => {
    if (count <= 0) {
      return 1;
    }
    const rawWeight = Math.pow(baselineCount / count, config.actionWeightPower);
    return clampNumber(rawWeight, config.minActionWeight, config.maxActionWeight);
  });
}

function sampleBalancedBatchIndices(indicesByAction, batchSize, random) {
  const nonEmptyActionIndices = indicesByAction
    .map((bucket, index) => (bucket.length ? index : -1))
    .filter((index) => index >= 0);

  if (!nonEmptyActionIndices.length || batchSize <= 0) {
    return [];
  }

  const batchIndices = [];
  const actionOrder = [...nonEmptyActionIndices];
  while (batchIndices.length < batchSize) {
    shuffleInPlace(actionOrder, random);
    for (const actionIndex of actionOrder) {
      const bucket = indicesByAction[actionIndex];
      const sampleIndex = bucket[Math.floor(random() * bucket.length)];
      batchIndices.push(sampleIndex);
      if (batchIndices.length >= batchSize) {
        break;
      }
    }
  }

  return batchIndices;
}

class DenseNetwork {
  constructor(inputSize, hiddenSizes, outputSize, random) {
    this.inputSize = inputSize;
    this.layers = [];

    const sizes = [inputSize, ...hiddenSizes, outputSize];
    for (let index = 0; index < sizes.length - 1; index += 1) {
      const layerInputSize = sizes[index];
      const layerOutputSize = sizes[index + 1];
      const activation = index === sizes.length - 2 ? "linear" : "relu";
      const scale = activation === "relu"
        ? Math.sqrt(2 / Math.max(layerInputSize, 1))
        : Math.sqrt(1 / Math.max(layerInputSize, 1));

      this.layers.push({
        inputSize: layerInputSize,
        outputSize: layerOutputSize,
        activation,
        weights: createMatrix(layerOutputSize, layerInputSize, 0).map((row) => (
          row.map(() => (random() * 2 - 1) * scale)
        )),
        biases: Array(layerOutputSize).fill(0),
      });
    }
  }

  forward(inputs) {
    const activations = [inputs];
    const preActivations = [];
    let current = inputs;

    for (const layer of this.layers) {
      const nextLinear = Array(layer.outputSize).fill(0);
      for (let outputIndex = 0; outputIndex < layer.outputSize; outputIndex += 1) {
        let value = layer.biases[outputIndex];
        for (let inputIndex = 0; inputIndex < layer.inputSize; inputIndex += 1) {
          value += layer.weights[outputIndex][inputIndex] * current[inputIndex];
        }
        nextLinear[outputIndex] = value;
      }

      preActivations.push(nextLinear);
      current = layer.activation === "relu"
        ? nextLinear.map((value) => Math.max(0, value))
        : [...nextLinear];
      activations.push(current);
    }

    return {
      activations,
      preActivations,
      output: activations[activations.length - 1],
    };
  }

  predict(inputs) {
    return this.forward(inputs).output;
  }

  createGradientAccumulator() {
    return this.layers.map((layer) => ({
      weights: createMatrix(layer.outputSize, layer.inputSize, 0),
      biases: Array(layer.outputSize).fill(0),
    }));
  }

  backward(cache, outputGradients, accumulator) {
    let gradients = [...outputGradients];

    for (let layerIndex = this.layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      const layer = this.layers[layerIndex];
      const layerPreActivations = cache.preActivations[layerIndex];
      const layerInputs = cache.activations[layerIndex];
      const layerAccumulator = accumulator[layerIndex];
      const adjustedGradients = [...gradients];

      if (layer.activation === "relu") {
        for (let outputIndex = 0; outputIndex < adjustedGradients.length; outputIndex += 1) {
          if (layerPreActivations[outputIndex] <= 0) {
            adjustedGradients[outputIndex] = 0;
          }
        }
      }

      const inputGradients = Array(layer.inputSize).fill(0);
      for (let outputIndex = 0; outputIndex < layer.outputSize; outputIndex += 1) {
        const gradient = adjustedGradients[outputIndex];
        layerAccumulator.biases[outputIndex] += gradient;
        for (let inputIndex = 0; inputIndex < layer.inputSize; inputIndex += 1) {
          layerAccumulator.weights[outputIndex][inputIndex] += gradient * layerInputs[inputIndex];
          inputGradients[inputIndex] += layer.weights[outputIndex][inputIndex] * gradient;
        }
      }

      gradients = inputGradients;
    }
  }

  applyGradients(accumulator, learningRate, sampleCount, gradientClip) {
    const scale = 1 / Math.max(sampleCount, 1);

    for (let layerIndex = 0; layerIndex < this.layers.length; layerIndex += 1) {
      const layer = this.layers[layerIndex];
      const layerAccumulator = accumulator[layerIndex];

      for (let outputIndex = 0; outputIndex < layer.outputSize; outputIndex += 1) {
        const biasGradient = layerAccumulator.biases[outputIndex] * scale;
        const clippedBiasGradient = Math.max(-gradientClip, Math.min(gradientClip, biasGradient));
        layer.biases[outputIndex] -= learningRate * clippedBiasGradient;

        for (let inputIndex = 0; inputIndex < layer.inputSize; inputIndex += 1) {
          const gradient = layerAccumulator.weights[outputIndex][inputIndex] * scale;
          const clippedGradient = Math.max(-gradientClip, Math.min(gradientClip, gradient));
          layer.weights[outputIndex][inputIndex] -= learningRate * clippedGradient;
        }
      }
    }
  }

  toModel(modeKey, metadata = {}) {
    return createPolicyModel({
      modeKey,
      observationSize: this.inputSize,
      metadata,
      layers: this.layers.map((layer) => ({
        inputSize: layer.inputSize,
        outputSize: layer.outputSize,
        activation: layer.activation,
        weights: layer.weights.map((row) => [...row]),
        biases: [...layer.biases],
      })),
    });
  }
}

function collectHeuristicSamples(env, config) {
  const samples = [];
  const results = [];
  const actionCounts = Array(ACTION_DEFINITIONS.length).fill(0);

  for (let episodeIndex = 0; episodeIndex < config.pretrainEpisodes; episodeIndex += 1) {
    let observation = env.reset(config.seed + 500000 + episodeIndex * 53);
    let done = false;
    let totalReward = 0;
    let finalInfo = null;
    let availableTileFractionSum = 0;
    let minimumAvailableTileFraction = 1;
    let stepCount = 0;

    while (!done) {
      const action = heuristicActionForGame(env.game);
      actionCounts[action] += 1;
      samples.push({
        observation,
        action,
      });

      const result = env.step(action);
      observation = result.observation;
      totalReward += result.reward;
      availableTileFractionSum += result.info.availableTileFraction;
      minimumAvailableTileFraction = Math.min(
        minimumAvailableTileFraction,
        result.info.availableTileFraction,
      );
      stepCount += 1;
      finalInfo = result.info;
      done = result.done;
    }

    results.push({
      reward: totalReward,
      score: finalInfo?.score ?? 0,
      steps: finalInfo?.steps ?? 0,
      holes: finalInfo?.holes ?? 0,
      averageAvailableTiles: stepCount
        ? (availableTileFractionSum / stepCount) * env.game.cases.length
        : env.game.cases.length,
      averageAvailableTileFraction: stepCount
        ? availableTileFractionSum / stepCount
        : 1,
      minimumAvailableTileFraction,
      doneReason: finalInfo?.doneReason ?? "unknown",
    });
  }

  const actionWeights = buildActionWeights(actionCounts, config);
  return {
    samples,
    metrics: summarizeEpisodes(results),
    actionCounts,
    actionWeights,
    actionDistribution: Object.fromEntries(
      actionCounts.map((count, index) => [actionKey(index), count]),
    ),
  };
}

function pretrainActor(actor, env, config, random) {
  if (config.pretrainEpisodes <= 0 || config.pretrainEpochs <= 0) {
    return null;
  }

  const {
    samples,
    metrics,
    actionCounts,
    actionWeights,
    actionDistribution,
  } = collectHeuristicSamples(env, config);
  if (!samples.length) {
    return {
      sampleCount: 0,
      metrics,
      actionCounts,
      actionWeights,
      actionDistribution,
    };
  }

  const indices = Array.from({ length: samples.length }, (_unused, index) => index);
  const indicesByAction = Array.from(
    { length: ACTION_DEFINITIONS.length },
    () => [],
  );
  for (let index = 0; index < samples.length; index += 1) {
    indicesByAction[samples[index].action].push(index);
  }

  for (let epoch = 0; epoch < config.pretrainEpochs; epoch += 1) {
    shuffleInPlace(indices, random);

    for (let batchStart = 0; batchStart < indices.length; batchStart += config.pretrainBatchSize) {
      const batchSize = Math.min(config.pretrainBatchSize, indices.length - batchStart);
      const batchIndices = config.pretrainBalancedBatches
        ? sampleBalancedBatchIndices(indicesByAction, batchSize, random)
        : indices.slice(batchStart, batchStart + batchSize);
      const accumulator = actor.createGradientAccumulator();
      let gradientWeightTotal = 0;

      for (const sampleIndex of batchIndices) {
        const sample = samples[sampleIndex];
        const cache = actor.forward(sample.observation);
        const probabilities = softmax(cache.output);
        const actionWeight = actionWeights[sample.action] ?? 1;
        const outputGradients = probabilities.map((probability, actionIndex) => (
          (probability - (actionIndex === sample.action ? 1 : 0)) * actionWeight
        ));
        actor.backward(cache, outputGradients, accumulator);
        gradientWeightTotal += actionWeight;
      }

      actor.applyGradients(
        accumulator,
        config.pretrainLearningRate,
        gradientWeightTotal,
        config.gradientClip,
      );
    }
  }

  return {
    sampleCount: samples.length,
    metrics,
    actionCounts,
    actionWeights,
    actionDistribution,
  };
}

function actionKey(actionIndex) {
  return (ACTION_DEFINITIONS[actionIndex] || ACTION_DEFINITIONS[0]).key;
}

function playerNearEdge(game) {
  const player = game.pyoro;
  if (!player) {
    return false;
  }

  const worldWidth = Math.max(game.cases?.length || 0, 1);

  return (
    player.x <= player.width / 2 + 0.75
    || player.x >= worldWidth - player.width / 2 - 0.75
  );
}

function summarizeEpisodes(results) {
  const scores = results.map((result) => result.score);
  const rewards = results.map((result) => result.reward);
  const steps = results.map((result) => result.steps);
  const holes = results.map((result) => result.holes);
  const availableTiles = results.map((result) => result.averageAvailableTiles ?? (32 - (result.holes ?? 0)));
  const availableTileFractions = results.map((result) => (
    result.averageAvailableTileFraction ?? ((result.averageAvailableTiles ?? (32 - (result.holes ?? 0))) / 32)
  ));
  const minimumAvailableTileFractions = results.map((result) => (
    result.minimumAvailableTileFraction
      ?? result.averageAvailableTileFraction
      ?? ((result.averageAvailableTiles ?? (32 - (result.holes ?? 0))) / 32)
  ));
  const heuristicAgreementRates = results.map((result) => result.heuristicAgreementRate ?? 0);
  const edgeHugRates = results.map((result) => result.edgeHugRate ?? 0);
  const idleRates = results.map((result) => result.idleRate ?? 0);
  const abilityRates = results.map((result) => result.abilityRate ?? 0);
  const horizontalSwitchRates = results.map((result) => result.horizontalSwitchRate ?? 0);
  const heuristicOverrideRates = results.map((result) => result.heuristicOverrideRate ?? 0);
  const longestSameActionStreaks = results.map((result) => result.longestSameActionStreak ?? 0);
  const zeroScoreCount = scores.filter((score) => score <= 0).length;
  const doneReasonCounts = {};
  const actionCounts = Array(ACTION_DEFINITIONS.length).fill(0);

  for (const result of results) {
    doneReasonCounts[result.doneReason] = (doneReasonCounts[result.doneReason] || 0) + 1;
    if (Array.isArray(result.actionCounts)) {
      for (let index = 0; index < actionCounts.length; index += 1) {
        actionCounts[index] += result.actionCounts[index] ?? 0;
      }
    }
  }

  const totalActionCount = actionCounts.reduce((sum, count) => sum + count, 0);
  const dominantActionCount = totalActionCount ? Math.max(...actionCounts) : 0;
  const dominantActionIndex = totalActionCount ? actionCounts.indexOf(dominantActionCount) : 0;

  const summary = {
    averageScore: average(scores),
    medianScore: median(scores),
    bestScore: scores.length ? Math.max(...scores) : 0,
    worstScore: scores.length ? Math.min(...scores) : 0,
    averageReward: average(rewards),
    averageSteps: average(steps),
    averageHoles: average(holes),
    averageAvailableTiles: average(availableTiles),
    averageAvailableTileFraction: average(availableTileFractions),
    averageMinimumAvailableTileFraction: average(minimumAvailableTileFractions),
    averageHeuristicAgreementRate: average(heuristicAgreementRates),
    averageEdgeHugRate: average(edgeHugRates),
    averageIdleRate: average(idleRates),
    averageAbilityRate: average(abilityRates),
    averageHorizontalSwitchRate: average(horizontalSwitchRates),
    averageHeuristicOverrideRate: average(heuristicOverrideRates),
    averageLongestSameActionStreak: average(longestSameActionStreaks),
    maxLongestSameActionStreak: longestSameActionStreaks.length ? Math.max(...longestSameActionStreaks) : 0,
    zeroScoreRate: zeroScoreCount / Math.max(scores.length, 1),
    dominantActionIndex,
    dominantActionKey: actionKey(dominantActionIndex),
    dominantActionFraction: safeRate(dominantActionCount, totalActionCount),
    actionCounts,
    actionDistribution: Object.fromEntries(
      actionCounts.map((count, index) => [actionKey(index), count]),
    ),
    doneReasonCounts,
  };

  summary.collapseWarnings = buildCollapseWarnings(summary);
  summary.qualityScore = qualityScore(summary);
  return summary;
}

function rolloutTrainingEpisode(actor, critic, env, seed, config, random, iteration) {
  let observation = env.reset(seed);
  const trajectory = [];
  let done = false;
  let finalInfo = null;
  let availableTileFractionSum = 0;
  let minimumAvailableTileFraction = 1;
  let stepCount = 0;
  const actionCounts = Array(ACTION_DEFINITIONS.length).fill(0);
  let heuristicAgreementCount = 0;
  let heuristicOverrideCount = 0;
  let edgeSteps = 0;
  let idleSteps = 0;
  let abilitySteps = 0;
  let horizontalSwitches = 0;
  let lastHorizontalDirection = 0;
  let sameActionStreak = 0;
  let longestSameActionStreak = 0;
  let lastActionIndex = null;
  const heuristicMix = heuristicMixForIteration(config, iteration);

  while (!done) {
    const logits = actor.predict(observation);
    const probabilities = softmax(logits);
    const heuristicActionIndex = heuristicActionForGame(env.game);
    const useHeuristicOverride = random() < heuristicMix;
    const action = useHeuristicOverride
      ? heuristicActionIndex
      : sampleSoftmax(probabilities, random);
    const actionDefinition = ACTION_DEFINITIONS[action] || ACTION_DEFINITIONS[0];
    const nearEdge = playerNearEdge(env.game);
    const value = critic.predict(observation)[0];

    actionCounts[action] += 1;
    if (action === heuristicActionIndex) {
      heuristicAgreementCount += 1;
    }
    if (useHeuristicOverride) {
      heuristicOverrideCount += 1;
    }
    if (nearEdge) {
      edgeSteps += 1;
    }
    if (actionDefinition.id === 0) {
      idleSteps += 1;
    }
    if (actionDefinition.abilityHeld) {
      abilitySteps += 1;
    }
    if (actionDefinition.horizontal !== 0) {
      if (
        lastHorizontalDirection !== 0
        && lastHorizontalDirection !== actionDefinition.horizontal
      ) {
        horizontalSwitches += 1;
      }
      lastHorizontalDirection = actionDefinition.horizontal;
    }
    sameActionStreak = lastActionIndex === action
      ? sameActionStreak + 1
      : 1;
    longestSameActionStreak = Math.max(longestSameActionStreak, sameActionStreak);
    lastActionIndex = action;

    const result = env.step(action);
    let reward = result.reward;
    const noProgress = result.info.stepsSinceScore >= config.stuckNoProgressThreshold;
    if (noProgress) {
      const repeatPenaltyFactor = Math.max(
        0,
        sameActionStreak - config.repeatActionThreshold + 1,
      ) / Math.max(config.repeatActionThreshold, 1);
      reward -= repeatPenaltyFactor * config.repeatActionPenaltyOverTime;
      if (nearEdge) {
        reward -= config.edgeHugPenaltyOverTime;
      }
      if (actionDefinition.id === 0) {
        reward -= config.idlePenaltyOverTime;
      }
    }

    const imitationWeight = config.imitationLossWeight * (
      1
      + (noProgress ? 1 : 0)
      + (1 - result.info.availableTileFraction)
    ) * (config.heuristicActionWeights?.[heuristicActionIndex] ?? 1);

    trajectory.push({
      observation,
      probabilities,
      action,
      heuristicActionIndex,
      usedHeuristicOverride: useHeuristicOverride,
      reward,
      value,
      imitationWeight,
    });
    availableTileFractionSum += result.info.availableTileFraction;
    minimumAvailableTileFraction = Math.min(
      minimumAvailableTileFraction,
      result.info.availableTileFraction,
    );
    stepCount += 1;

    observation = result.observation;
    done = result.done;
    finalInfo = result.info;
  }

  const returns = discountedReturns(
    trajectory.map((step) => step.reward),
    config.discount,
  );

  let totalReward = 0;
  for (let index = 0; index < trajectory.length; index += 1) {
    trajectory[index].returnValue = returns[index];
    totalReward += trajectory[index].reward;
  }

  return {
    trajectory,
    summary: {
      reward: totalReward,
      score: finalInfo?.score ?? 0,
      steps: finalInfo?.steps ?? trajectory.length,
      holes: finalInfo?.holes ?? 0,
      averageAvailableTiles: stepCount
        ? (availableTileFractionSum / stepCount) * env.game.cases.length
        : env.game.cases.length,
      averageAvailableTileFraction: stepCount
        ? availableTileFractionSum / stepCount
        : 1,
      minimumAvailableTileFraction,
      heuristicAgreementRate: safeRate(heuristicAgreementCount, stepCount),
      heuristicOverrideRate: safeRate(heuristicOverrideCount, stepCount),
      edgeHugRate: safeRate(edgeSteps, stepCount),
      idleRate: safeRate(idleSteps, stepCount),
      abilityRate: safeRate(abilitySteps, stepCount),
      horizontalSwitchRate: safeRate(horizontalSwitches, stepCount),
      longestSameActionStreak,
      actionCounts,
      doneReason: finalInfo?.doneReason ?? "unknown",
    },
  };
}

function rolloutEvaluationEpisode(actor, env, seed) {
  let observation = env.reset(seed);
  let done = false;
  let totalReward = 0;
  let finalInfo = null;
  let availableTileFractionSum = 0;
  let minimumAvailableTileFraction = 1;
  let stepCount = 0;
  const actionCounts = Array(ACTION_DEFINITIONS.length).fill(0);
  let heuristicAgreementCount = 0;
  let edgeSteps = 0;
  let idleSteps = 0;
  let abilitySteps = 0;
  let horizontalSwitches = 0;
  let lastHorizontalDirection = 0;
  let sameActionStreak = 0;
  let longestSameActionStreak = 0;
  let lastActionIndex = null;

  while (!done) {
    const logits = actor.predict(observation);
    let action = 0;
    for (let index = 1; index < logits.length; index += 1) {
      if (logits[index] > logits[action]) {
        action = index;
      }
    }

    const heuristicActionIndex = heuristicActionForGame(env.game);
    const actionDefinition = ACTION_DEFINITIONS[action] || ACTION_DEFINITIONS[0];
    const nearEdge = playerNearEdge(env.game);
    actionCounts[action] += 1;
    if (action === heuristicActionIndex) {
      heuristicAgreementCount += 1;
    }
    if (nearEdge) {
      edgeSteps += 1;
    }
    if (actionDefinition.id === 0) {
      idleSteps += 1;
    }
    if (actionDefinition.abilityHeld) {
      abilitySteps += 1;
    }
    if (actionDefinition.horizontal !== 0) {
      if (
        lastHorizontalDirection !== 0
        && lastHorizontalDirection !== actionDefinition.horizontal
      ) {
        horizontalSwitches += 1;
      }
      lastHorizontalDirection = actionDefinition.horizontal;
    }
    sameActionStreak = lastActionIndex === action
      ? sameActionStreak + 1
      : 1;
    longestSameActionStreak = Math.max(longestSameActionStreak, sameActionStreak);
    lastActionIndex = action;

    const result = env.step(action);
    observation = result.observation;
    totalReward += result.reward;
    availableTileFractionSum += result.info.availableTileFraction;
    minimumAvailableTileFraction = Math.min(
      minimumAvailableTileFraction,
      result.info.availableTileFraction,
    );
    stepCount += 1;
    finalInfo = result.info;
    done = result.done;
  }

  return {
    reward: totalReward,
    score: finalInfo?.score ?? 0,
    steps: finalInfo?.steps ?? 0,
    holes: finalInfo?.holes ?? 0,
    averageAvailableTiles: stepCount
      ? (availableTileFractionSum / stepCount) * env.game.cases.length
      : env.game.cases.length,
    averageAvailableTileFraction: stepCount
      ? availableTileFractionSum / stepCount
      : 1,
    minimumAvailableTileFraction,
    heuristicAgreementRate: safeRate(heuristicAgreementCount, stepCount),
    heuristicOverrideRate: 0,
    edgeHugRate: safeRate(edgeSteps, stepCount),
    idleRate: safeRate(idleSteps, stepCount),
    abilityRate: safeRate(abilitySteps, stepCount),
    horizontalSwitchRate: safeRate(horizontalSwitches, stepCount),
    longestSameActionStreak,
    actionCounts,
    doneReason: finalInfo?.doneReason ?? "unknown",
  };
}

function trainIteration(actor, critic, env, config, random, iteration) {
  const seeds = buildTrainingSeeds(config, iteration);
  const rollouts = seeds.map((seed) => (
    rolloutTrainingEpisode(actor, critic, env, seed, config, random, iteration)
  ));

  const actorAccumulator = actor.createGradientAccumulator();
  const criticAccumulator = critic.createGradientAccumulator();
  const rawAdvantages = [];

  for (const rollout of rollouts) {
    for (const step of rollout.trajectory) {
      rawAdvantages.push(step.returnValue - step.value);
    }
  }

  const normalizedAdvantages = standardize(rawAdvantages);
  let advantageIndex = 0;
  let sampleCount = 0;

  for (const rollout of rollouts) {
    for (const step of rollout.trajectory) {
      const advantage = normalizedAdvantages[advantageIndex];
      advantageIndex += 1;
      sampleCount += 1;

      const actorCache = actor.forward(step.observation);
      const actorOutputGradients = step.probabilities.map((probability, actionIndex) => {
        let gradient = 0;
        if (!step.usedHeuristicOverride) {
          gradient += (probability - (actionIndex === step.action ? 1 : 0)) * advantage;
        }
        gradient += (probability - (actionIndex === step.heuristicActionIndex ? 1 : 0)) * step.imitationWeight;
        return gradient;
      });
      actor.backward(actorCache, actorOutputGradients, actorAccumulator);

      const criticCache = critic.forward(step.observation);
      const criticOutputGradients = [criticCache.output[0] - step.returnValue];
      critic.backward(criticCache, criticOutputGradients, criticAccumulator);
    }
  }

  actor.applyGradients(
    actorAccumulator,
    config.actorLearningRate,
    sampleCount,
    config.gradientClip,
  );
  critic.applyGradients(
    criticAccumulator,
    config.criticLearningRate,
    sampleCount,
    config.gradientClip,
  );

  return summarizeEpisodes(rollouts.map((rollout) => rollout.summary));
}

function evaluatePolicy(actor, env, evalSeeds) {
  const results = evalSeeds.map((seed) => rolloutEvaluationEpisode(actor, env, seed));
  return summarizeEpisodes(results);
}

function buildModelMetadata(modeKey, config, envOptions, evalSeeds, metrics, extra = {}) {
  return {
    trainer: "actor-critic-mlp-v3",
    seed: config.seed,
    iterationsCompleted: extra.iterationsCompleted ?? config.iterations,
    hiddenSizes: config.hiddenSizes,
    training: {
      iterations: config.iterations,
      batchEpisodes: config.batchEpisodes,
      evalEpisodes: config.evalEpisodes,
      discount: config.discount,
      actorLearningRate: config.actorLearningRate,
      criticLearningRate: config.criticLearningRate,
      gradientClip: config.gradientClip,
      heuristicMixStart: config.heuristicMixStart,
      heuristicMixEnd: config.heuristicMixEnd,
      imitationLossWeight: config.imitationLossWeight,
      stuckNoProgressThreshold: config.stuckNoProgressThreshold,
      repeatActionThreshold: config.repeatActionThreshold,
      repeatActionPenaltyOverTime: config.repeatActionPenaltyOverTime,
      edgeHugPenaltyOverTime: config.edgeHugPenaltyOverTime,
      idlePenaltyOverTime: config.idlePenaltyOverTime,
      actionWeightPower: config.actionWeightPower,
      minActionWeight: config.minActionWeight,
      maxActionWeight: config.maxActionWeight,
      pretrainBalancedBatches: config.pretrainBalancedBatches,
      heuristicActionWeights: config.heuristicActionWeights,
    },
    pretraining: extra.pretraining,
    averageScore: metrics.averageScore,
    averageAvailableTiles: metrics.averageAvailableTiles,
    averageAvailableTileFraction: metrics.averageAvailableTileFraction,
    averageMinimumAvailableTileFraction: metrics.averageMinimumAvailableTileFraction,
    medianScore: metrics.medianScore,
    averageReward: metrics.averageReward,
    zeroScoreRate: metrics.zeroScoreRate,
    dominantActionKey: metrics.dominantActionKey,
    dominantActionFraction: metrics.dominantActionFraction,
    averageHeuristicAgreementRate: metrics.averageHeuristicAgreementRate,
    averageEdgeHugRate: metrics.averageEdgeHugRate,
    averageIdleRate: metrics.averageIdleRate,
    averageAbilityRate: metrics.averageAbilityRate,
    averageHorizontalSwitchRate: metrics.averageHorizontalSwitchRate,
    maxLongestSameActionStreak: metrics.maxLongestSameActionStreak,
    collapseWarnings: metrics.collapseWarnings,
    qualityScore: metrics.qualityScore,
    evaluationSeeds: evalSeeds,
    environment: {
      maxSteps: config.maxSteps,
      maxNoScoreSteps: config.maxNoScoreSteps,
      rewardConfig: envOptions.rewardConfig,
    },
    mode: modeKey,
  };
}

const args = parseArgs(process.argv.slice(2));
const modeKey = parseMode(args.get("mode"));
const defaultHeuristicMixStart = modeKey === "pyoro2" ? 0.55 : 0.4;
const defaultHeuristicMixEnd = modeKey === "pyoro2" ? 0.18 : 0.1;
const defaultImitationLossWeight = modeKey === "pyoro2" ? 0.3 : 0.22;
const config = {
  mode: modeKey,
  seed: parseIntOption(args, "seed", 1337),
  iterations: parseIntOption(args, "iterations", 160),
  batchEpisodes: parseIntOption(args, "batch-episodes", 24),
  evalEpisodes: parseIntOption(args, "eval-episodes", 12),
  pretrainEpisodes: parseIntOption(args, "pretrain-episodes", 96),
  pretrainEpochs: parseIntOption(args, "pretrain-epochs", 4),
  pretrainBatchSize: parseIntOption(args, "pretrain-batch-size", 1024),
  maxSteps: parseIntOption(args, "max-steps", 3600),
  maxNoScoreSteps: parseIntOption(args, "max-no-score-steps", 480),
  pretrainLearningRate: parseFloatOption(args, "pretrain-learning-rate", 0.01),
  actorLearningRate: parseFloatOption(args, "actor-learning-rate", 0.0025),
  criticLearningRate: parseFloatOption(args, "critic-learning-rate", 0.01),
  discount: parseFloatOption(args, "discount", 0.995),
  gradientClip: parseFloatOption(args, "gradient-clip", 1),
  hiddenSizes: parseIntListOption(args, "hidden-sizes", [128, 128]),
  scoreScale: parseFloatOption(args, "score-scale", 0.01),
  holePenalty: parseFloatOption(args, "hole-penalty", 0.3),
  repairReward: parseFloatOption(args, "repair-reward", 0.08),
  deathPenalty: parseFloatOption(args, "death-penalty", 1.5),
  survivalReward: parseFloatOption(args, "survival-reward", 0),
  noScoreTimeoutPenalty: parseFloatOption(args, "no-score-timeout-penalty", 1),
  floorDamagePenaltyOverTime: parseFloatOption(args, "floor-damage-penalty-over-time", 0.002),
  heuristicMixStart: parseFloatOption(args, "heuristic-mix-start", defaultHeuristicMixStart),
  heuristicMixEnd: parseFloatOption(args, "heuristic-mix-end", defaultHeuristicMixEnd),
  imitationLossWeight: parseFloatOption(args, "imitation-loss-weight", defaultImitationLossWeight),
  stuckNoProgressThreshold: parseIntOption(args, "stuck-no-progress-threshold", 90),
  repeatActionThreshold: parseIntOption(args, "repeat-action-threshold", 75),
  repeatActionPenaltyOverTime: parseFloatOption(args, "repeat-action-penalty-over-time", 0.004),
  edgeHugPenaltyOverTime: parseFloatOption(args, "edge-hug-penalty-over-time", 0.002),
  idlePenaltyOverTime: parseFloatOption(args, "idle-penalty-over-time", 0.0025),
  actionWeightPower: parseFloatOption(args, "action-weight-power", modeKey === "pyoro2" ? 0.7 : 0.45),
  minActionWeight: parseFloatOption(args, "min-action-weight", 0.35),
  maxActionWeight: parseFloatOption(args, "max-action-weight", modeKey === "pyoro2" ? 8 : 5),
  pretrainBalancedBatches: args.get("pretrain-balanced-batches") !== "false",
  heuristicActionWeights: Array(ACTION_DEFINITIONS.length).fill(1),
};

const outputPath = path.resolve(
  projectRoot,
  args.get("output") || path.join("web", "models", `${modeKey}-agent.json`),
);

const envOptions = {
  mode: modeKey,
  seed: config.seed,
  maxSteps: config.maxSteps,
  maxNoScoreSteps: config.maxNoScoreSteps,
  rewardConfig: {
    scoreScale: config.scoreScale,
    holePenalty: config.holePenalty,
    repairReward: config.repairReward,
    deathPenalty: config.deathPenalty,
    survivalReward: config.survivalReward,
    noScoreTimeoutPenalty: config.noScoreTimeoutPenalty,
    floorDamagePenaltyOverTime: config.floorDamagePenaltyOverTime,
  },
};

const rng = createSeededRandom(config.seed);
const trainingEnv = new PyoroHeadlessEnv(envOptions);
const evaluationEnv = new PyoroHeadlessEnv(envOptions);
const actor = new DenseNetwork(trainingEnv.observationSize(), config.hiddenSizes, ACTION_DEFINITIONS.length, rng);
const critic = new DenseNetwork(trainingEnv.observationSize(), config.hiddenSizes, 1, rng);
const evalSeeds = buildEvalSeeds(config);

const pretraining = pretrainActor(actor, trainingEnv, config, rng);
if (pretraining?.actionWeights) {
  config.heuristicActionWeights = [...pretraining.actionWeights];
}
if (pretraining) {
  console.log(
    [
      "pretrain",
      `samples=${pretraining.sampleCount}`,
      `score=${pretraining.metrics.averageScore.toFixed(1)}`,
      `floor=${(pretraining.metrics.averageAvailableTileFraction * 100).toFixed(1)}%`,
      `median=${pretraining.metrics.medianScore.toFixed(1)}`,
      `zero=${(pretraining.metrics.zeroScoreRate * 100).toFixed(0)}%`,
      `weights=${pretraining.actionWeights.map((value) => value.toFixed(2)).join(",")}`,
    ].join(" "),
  );
}

let bestMetrics = null;
let bestModel = null;

if (pretraining) {
  const pretrainEvalMetrics = evaluatePolicy(actor, evaluationEnv, evalSeeds);
  bestMetrics = pretrainEvalMetrics;
  bestModel = actor.toModel(
    modeKey,
    buildModelMetadata(modeKey, config, envOptions, evalSeeds, pretrainEvalMetrics, {
      iterationsCompleted: 0,
      pretraining: {
        episodes: config.pretrainEpisodes,
        epochs: config.pretrainEpochs,
        batchSize: config.pretrainBatchSize,
        learningRate: config.pretrainLearningRate,
        heuristicMetrics: pretraining.metrics,
        actionDistribution: pretraining.actionDistribution,
        actionWeights: pretraining.actionWeights,
        evalMetrics: pretrainEvalMetrics,
      },
    }),
  );

  console.log(
    [
      "pretrain_eval",
      `score=${pretrainEvalMetrics.averageScore.toFixed(1)}`,
      `floor=${(pretrainEvalMetrics.averageAvailableTileFraction * 100).toFixed(1)}%`,
      `median=${pretrainEvalMetrics.medianScore.toFixed(1)}`,
      `reward=${pretrainEvalMetrics.averageReward.toFixed(3)}`,
      `zero=${(pretrainEvalMetrics.zeroScoreRate * 100).toFixed(0)}%`,
      `dom=${pretrainEvalMetrics.dominantActionKey}:${Math.round(pretrainEvalMetrics.dominantActionFraction * 100)}%`,
      `agree=${Math.round(pretrainEvalMetrics.averageHeuristicAgreementRate * 100)}%`,
      `edge=${Math.round(pretrainEvalMetrics.averageEdgeHugRate * 100)}%`,
      `streak=${pretrainEvalMetrics.maxLongestSameActionStreak}`,
      `quality=${pretrainEvalMetrics.qualityScore.toFixed(1)}`,
    ].join(" "),
  );
}

for (let iteration = 0; iteration < config.iterations; iteration += 1) {
  const trainMetrics = trainIteration(
    actor,
    critic,
    trainingEnv,
    config,
    rng,
    iteration,
  );

  const evalMetrics = evaluatePolicy(actor, evaluationEnv, evalSeeds);

  if (!bestMetrics || compareMetrics(evalMetrics, bestMetrics) > 0) {
    bestMetrics = evalMetrics;
    bestModel = actor.toModel(
      modeKey,
      buildModelMetadata(modeKey, config, envOptions, evalSeeds, evalMetrics, {
        iterationsCompleted: iteration + 1,
        pretraining: {
          episodes: config.pretrainEpisodes,
          epochs: config.pretrainEpochs,
          batchSize: config.pretrainBatchSize,
          learningRate: config.pretrainLearningRate,
        },
      }),
    );
  }

  console.log(
    [
      `iter=${String(iteration + 1).padStart(3, "0")}`,
      `mix=${(heuristicMixForIteration(config, iteration) * 100).toFixed(0)}%`,
      `train_score=${trainMetrics.averageScore.toFixed(1)}`,
      `train_floor=${(trainMetrics.averageAvailableTileFraction * 100).toFixed(1)}%`,
      `train_reward=${trainMetrics.averageReward.toFixed(3)}`,
      `train_zero=${(trainMetrics.zeroScoreRate * 100).toFixed(0)}%`,
      `train_dom=${trainMetrics.dominantActionKey}:${Math.round(trainMetrics.dominantActionFraction * 100)}%`,
      `train_agree=${Math.round(trainMetrics.averageHeuristicAgreementRate * 100)}%`,
      `eval_score=${evalMetrics.averageScore.toFixed(1)}`,
      `eval_floor=${(evalMetrics.averageAvailableTileFraction * 100).toFixed(1)}%`,
      `eval_median=${evalMetrics.medianScore.toFixed(1)}`,
      `eval_reward=${evalMetrics.averageReward.toFixed(3)}`,
      `eval_zero=${(evalMetrics.zeroScoreRate * 100).toFixed(0)}%`,
      `eval_dom=${evalMetrics.dominantActionKey}:${Math.round(evalMetrics.dominantActionFraction * 100)}%`,
      `eval_agree=${Math.round(evalMetrics.averageHeuristicAgreementRate * 100)}%`,
      `eval_edge=${Math.round(evalMetrics.averageEdgeHugRate * 100)}%`,
      `eval_streak=${evalMetrics.maxLongestSameActionStreak}`,
      `quality=${evalMetrics.qualityScore.toFixed(1)}`,
      `steps=${trainMetrics.averageSteps.toFixed(1)}`,
    ].join(" "),
  );
}

if (!bestModel) {
  const fallbackMetrics = bestMetrics || evaluatePolicy(actor, evaluationEnv, evalSeeds);
  bestModel = actor.toModel(
    modeKey,
    buildModelMetadata(modeKey, config, envOptions, evalSeeds, fallbackMetrics, {
      iterationsCompleted: config.iterations,
      pretraining: {
        episodes: config.pretrainEpisodes,
        epochs: config.pretrainEpochs,
        batchSize: config.pretrainBatchSize,
        learningRate: config.pretrainLearningRate,
      },
    }),
  );
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(bestModel, null, 2)}\n`, "utf8");

console.log(`Saved ${modeKey} policy to ${outputPath}`);
