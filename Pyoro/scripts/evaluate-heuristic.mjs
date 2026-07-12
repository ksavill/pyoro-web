import { PyoroWebGame } from "../web/app.js";

function parseArgs(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      options.set(part.slice(2), "true");
    } else {
      options.set(part.slice(2), value);
      index += 1;
    }
  }
  return options;
}

function integerOption(options, key, fallback) {
  const value = Number.parseInt(options.get(key) ?? "", 10);
  return Number.isInteger(value) ? value : fallback;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const options = parseArgs(process.argv.slice(2));
const mode = options.get("mode") === "pyoro1" ? "pyoro1" : "pyoro2";
const episodes = Math.max(1, integerOption(options, "episodes", 20));
const seed = integerOption(options, "seed", 7331);
const maxSteps = Math.max(1, integerOption(options, "max-steps", 120000));
const maxNoScoreSteps = Math.max(0, integerOption(options, "max-no-score-steps", 0));
const targetScore = Math.max(0, integerOption(options, "target-score", 5000));
const scores = [];
const steps = [];
const doneReasons = {};

for (let episode = 0; episode < episodes; episode += 1) {
  const episodeSeed = seed + episode;
  const game = new PyoroWebGame({
    headless: true,
    selectedMode: mode === "pyoro2" ? 1 : 0,
    seed: episodeSeed,
  });
  game.setSeed(episodeSeed);
  game.startNewRun(game.selectedMode);
  game.autoPlayer = true;

  let episodeSteps = 0;
  let stepsSinceScore = 0;
  while (!game.pyoro.dead && !game.gameOver && episodeSteps < maxSteps) {
    const scoreBefore = game.score;
    game.runFixedStep(null);
    episodeSteps += 1;
    stepsSinceScore = game.score > scoreBefore ? 0 : stepsSinceScore + 1;
    if (maxNoScoreSteps > 0 && stepsSinceScore >= maxNoScoreSteps) {
      break;
    }
  }

  const doneReason = game.pyoro.dead
    ? "dead"
    : game.gameOver
      ? "game_over"
      : maxNoScoreSteps > 0 && stepsSinceScore >= maxNoScoreSteps
        ? "no_score_timeout"
        : "max_steps";

  scores.push(game.score);
  steps.push(episodeSteps);
  doneReasons[doneReason] = (doneReasons[doneReason] || 0) + 1;
  console.log([
    `episode=${String(episode + 1).padStart(2, "0")}`,
    `seed=${episodeSeed}`,
    `score=${game.score}`,
    `steps=${episodeSteps}`,
    `holes=${game.holeCount()}`,
    `done=${doneReason}`,
  ].join(" "));
}

console.log("");
console.log(`mode=${mode}`);
console.log(`episodes=${episodes}`);
console.log(`average_score=${average(scores).toFixed(2)}`);
console.log(`median_score=${median(scores).toFixed(2)}`);
console.log(`minimum_score=${Math.min(...scores)}`);
console.log(`maximum_score=${Math.max(...scores)}`);
console.log(`average_steps=${average(steps).toFixed(2)}`);
console.log(`target_score=${targetScore}`);
console.log(`target_clear_rate=${(
  scores.filter((score) => score > targetScore).length / scores.length
).toFixed(3)}`);
console.log(`done_reasons=${JSON.stringify(doneReasons)}`);
