import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_DEFINITIONS,
  inferPolicyLogits,
  softmax,
  validatePolicyModel,
} from "../web/agent-policy.js";
import { heuristicDecisionForGame } from "../web/heuristic-policy.js";
import { PyoroHeadlessEnv } from "../web/headless-env.js";

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

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function actionLabel(index) {
  return (ACTION_DEFINITIONS[index] || ACTION_DEFINITIONS[0]).key;
}

const args = parseArgs(process.argv.slice(2));
const modeKey = parseMode(args.get("mode"));

const defaultModelPath = path.join("web", "models", `${modeKey}-agent.json`);
const modelPath = path.resolve(projectRoot, args.get("model") || defaultModelPath);

const raw = await readFile(modelPath, "utf8");
const model = validatePolicyModel(JSON.parse(raw));
const envMetadata = model.metadata?.environment || {};

const episodes = parseIntOption(args, "episodes", 20);
const maxSteps = args.has("max-steps")
  ? parseIntOption(args, "max-steps", 3600)
  : (envMetadata.maxSteps ?? 3600);
const maxNoScoreSteps = args.has("max-no-score-steps")
  ? parseIntOption(args, "max-no-score-steps", 480)
  : (envMetadata.maxNoScoreSteps ?? 480);
const seed = parseIntOption(args, "seed", 7331);
const env = new PyoroHeadlessEnv({
  mode: modeKey,
  maxSteps,
  seed,
  maxNoScoreSteps,
  rewardConfig: {
    scoreScale: parseFloatOption(args, "score-scale", envMetadata.rewardConfig?.scoreScale ?? 0.01),
    holePenalty: parseFloatOption(args, "hole-penalty", envMetadata.rewardConfig?.holePenalty ?? 0.3),
    repairReward: parseFloatOption(args, "repair-reward", envMetadata.rewardConfig?.repairReward ?? 0.08),
    deathPenalty: parseFloatOption(args, "death-penalty", envMetadata.rewardConfig?.deathPenalty ?? 1.5),
    survivalReward: parseFloatOption(args, "survival-reward", envMetadata.rewardConfig?.survivalReward ?? 0),
    noScoreTimeoutPenalty: parseFloatOption(
      args,
      "no-score-timeout-penalty",
      envMetadata.rewardConfig?.noScoreTimeoutPenalty ?? 1,
    ),
    floorDamagePenaltyOverTime: parseFloatOption(
      args,
      "floor-damage-penalty-over-time",
      envMetadata.rewardConfig?.floorDamagePenaltyOverTime ?? 0.002,
    ),
  },
});

if (model.modeKey && model.modeKey !== modeKey) {
  throw new Error(`Model is for ${model.modeKey}, but --mode ${modeKey} was requested.`);
}
if (model.observationSize !== env.observationSize()) {
  throw new Error(
    `Model expects observation size ${model.observationSize}, but the environment produces ${env.observationSize()}.`,
  );
}

let totalScore = 0;
let totalReward = 0;
let bestScore = Number.NEGATIVE_INFINITY;
let worstScore = Number.POSITIVE_INFINITY;
let totalSteps = 0;
const scores = [];
const doneReasonCounts = {};
let availableTileFractionSum = 0;
let minimumAvailableTileFractionSum = 0;
const globalActionCounts = Array(ACTION_DEFINITIONS.length).fill(0);
let globalDecisionCount = 0;
let totalHeuristicAgreement = 0;
let totalEdgeSteps = 0;
let totalIdleSteps = 0;
let totalAbilitySteps = 0;
let totalHorizontalSwitches = 0;
let longestSameActionStreak = 0;
let totalConfidence = 0;

for (let episodeIndex = 0; episodeIndex < episodes; episodeIndex += 1) {
  let observation = env.reset(seed + episodeIndex);
  let done = false;
  let reward = 0;
  let finalScore = 0;
  let steps = 0;
  let doneReason = "unknown";
  let episodeAvailableTileFractionSum = 0;
  let episodeMinimumAvailableTileFraction = 1;
  let episodeStepCount = 0;
  let episodeActionCounts = Array(ACTION_DEFINITIONS.length).fill(0);
  let episodeSameActionStreak = 0;
  let episodeLongestSameActionStreak = 0;
  let episodeLastActionIndex = null;
  let episodeLastHorizontalDirection = 0;
  let episodeHeuristicAgreement = 0;
  let episodeEdgeSteps = 0;

  while (!done) {
    const logits = inferPolicyLogits(model, observation);
    const probabilities = softmax(logits);
    let action = 0;
    for (let index = 1; index < logits.length; index += 1) {
      if (logits[index] > logits[action]) {
        action = index;
      }
    }

    const heuristicDecision = heuristicDecisionForGame(env.game);
    const actionDefinition = ACTION_DEFINITIONS[action] || ACTION_DEFINITIONS[0];
    episodeActionCounts[action] += 1;
    globalActionCounts[action] += 1;
    globalDecisionCount += 1;
    totalConfidence += Math.max(...probabilities);

    episodeSameActionStreak = episodeLastActionIndex === action
      ? episodeSameActionStreak + 1
      : 1;
    episodeLongestSameActionStreak = Math.max(episodeLongestSameActionStreak, episodeSameActionStreak);
    longestSameActionStreak = Math.max(longestSameActionStreak, episodeLongestSameActionStreak);
    episodeLastActionIndex = action;

    if (actionDefinition.horizontal !== 0) {
      if (
        episodeLastHorizontalDirection !== 0
        && episodeLastHorizontalDirection !== actionDefinition.horizontal
      ) {
        totalHorizontalSwitches += 1;
      }
      episodeLastHorizontalDirection = actionDefinition.horizontal;
    }

    if (heuristicDecision.actionIndex === action) {
      episodeHeuristicAgreement += 1;
      totalHeuristicAgreement += 1;
    }

    if (actionDefinition.id === 0) {
      totalIdleSteps += 1;
    }
    if (actionDefinition.abilityHeld) {
      totalAbilitySteps += 1;
    }
    if (
      env.game.pyoro
      && (
        env.game.pyoro.x <= env.game.pyoro.width / 2 + 0.75
        || env.game.pyoro.x >= 32 - env.game.pyoro.width / 2 - 0.75
      )
    ) {
      episodeEdgeSteps += 1;
      totalEdgeSteps += 1;
    }

    const result = env.step(action);
    observation = result.observation;
    reward += result.reward;
    finalScore = result.info.score;
    steps = result.info.steps;
    doneReason = result.info.doneReason;
    episodeAvailableTileFractionSum += result.info.availableTileFraction;
    episodeMinimumAvailableTileFraction = Math.min(
      episodeMinimumAvailableTileFraction,
      result.info.availableTileFraction,
    );
    episodeStepCount += 1;
    done = result.done;
  }

  totalScore += finalScore;
  totalReward += reward;
  bestScore = Math.max(bestScore, finalScore);
  worstScore = Math.min(worstScore, finalScore);
  totalSteps += steps;
  scores.push(finalScore);
  availableTileFractionSum += episodeStepCount
    ? episodeAvailableTileFractionSum / episodeStepCount
    : 1;
  minimumAvailableTileFractionSum += episodeMinimumAvailableTileFraction;
  doneReasonCounts[doneReason] = (doneReasonCounts[doneReason] || 0) + 1;

  const dominantActionCount = Math.max(...episodeActionCounts);
  const dominantActionIndex = episodeActionCounts.indexOf(dominantActionCount);
  const episodeDominantActionFraction = dominantActionCount / Math.max(episodeStepCount, 1);
  const episodeHeuristicAgreementRate = episodeHeuristicAgreement / Math.max(episodeStepCount, 1);
  const episodeEdgeRate = episodeEdgeSteps / Math.max(episodeStepCount, 1);

  console.log(
    [
      `episode=${String(episodeIndex + 1).padStart(2, "0")}`,
      `score=${finalScore.toFixed(0)}`,
      `reward=${reward.toFixed(3)}`,
      `steps=${steps}`,
      `done=${doneReason}`,
      `dominant=${actionLabel(dominantActionIndex)}:${(episodeDominantActionFraction * 100).toFixed(0)}%`,
      `agree=${(episodeHeuristicAgreementRate * 100).toFixed(0)}%`,
      `edge=${(episodeEdgeRate * 100).toFixed(0)}%`,
      `streak=${episodeLongestSameActionStreak}`,
    ].join(" "),
  );
}

const dominantActionCount = Math.max(...globalActionCounts);
const dominantActionIndex = globalActionCounts.indexOf(dominantActionCount);
const dominantActionFraction = dominantActionCount / Math.max(globalDecisionCount, 1);
const edgeHugRate = totalEdgeSteps / Math.max(globalDecisionCount, 1);
const heuristicAgreementRate = totalHeuristicAgreement / Math.max(globalDecisionCount, 1);
const idleRate = totalIdleSteps / Math.max(globalDecisionCount, 1);
const abilityRate = totalAbilitySteps / Math.max(globalDecisionCount, 1);
const averageConfidence = totalConfidence / Math.max(globalDecisionCount, 1);
const collapseReasons = [];
if (dominantActionFraction >= 0.75) {
  collapseReasons.push("dominant_action");
}
if (edgeHugRate >= 0.55) {
  collapseReasons.push("edge_hugging");
}
if (longestSameActionStreak >= 240) {
  collapseReasons.push("long_same_action_streak");
}
if (idleRate >= 0.6) {
  collapseReasons.push("idle_heavy");
}

console.log("");
console.log(`mode=${modeKey}`);
console.log(`episodes=${episodes}`);
console.log(`average_score=${(totalScore / episodes).toFixed(2)}`);
console.log(`median_score=${median(scores).toFixed(2)}`);
console.log(`average_reward=${(totalReward / episodes).toFixed(3)}`);
console.log(`average_steps=${(totalSteps / episodes).toFixed(2)}`);
console.log(`average_available_tile_fraction=${(availableTileFractionSum / episodes).toFixed(3)}`);
console.log(`average_minimum_available_tile_fraction=${(minimumAvailableTileFractionSum / episodes).toFixed(3)}`);
console.log(`best_score=${bestScore.toFixed(0)}`);
console.log(`worst_score=${worstScore.toFixed(0)}`);
console.log(`zero_score_rate=${(scores.filter((score) => score <= 0).length / episodes).toFixed(3)}`);
console.log(`dominant_action=${actionLabel(dominantActionIndex)}`);
console.log(`dominant_action_fraction=${dominantActionFraction.toFixed(3)}`);
console.log(`average_heuristic_agreement=${heuristicAgreementRate.toFixed(3)}`);
console.log(`edge_hug_rate=${edgeHugRate.toFixed(3)}`);
console.log(`idle_rate=${idleRate.toFixed(3)}`);
console.log(`ability_rate=${abilityRate.toFixed(3)}`);
console.log(`average_confidence=${averageConfidence.toFixed(3)}`);
console.log(`longest_same_action_streak=${longestSameActionStreak}`);
console.log(`action_distribution=${JSON.stringify(Object.fromEntries(globalActionCounts.map((count, index) => [actionLabel(index), count])))}`);
console.log(`collapse_warnings=${JSON.stringify(collapseReasons)}`);
console.log(`done_reasons=${JSON.stringify(doneReasonCounts)}`);
