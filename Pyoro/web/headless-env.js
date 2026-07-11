import { PyoroWebGame } from "./app.js";

const DEFAULT_REWARD_CONFIG = Object.freeze({
  scoreScale: 0.01,
  holePenalty: 0.3,
  repairReward: 0.08,
  deathPenalty: 1.5,
  survivalReward: 0,
  noScoreTimeoutPenalty: 1,
  floorDamagePenaltyOverTime: 0.002,
});

const DEFAULT_EPISODE_CONFIG = Object.freeze({
  maxSteps: 3600,
  maxNoScoreSteps: 480,
});

function normalizeModeId(mode) {
  if (mode === 1 || mode === "1" || mode === "pyoro2") {
    return 1;
  }
  return 0;
}

export class PyoroHeadlessEnv {
  constructor(options = {}) {
    this.modeId = normalizeModeId(options.mode);
    this.fixedStep = options.fixedStep ?? 1 / 60;
    this.maxSteps = options.maxSteps ?? DEFAULT_EPISODE_CONFIG.maxSteps;
    this.maxNoScoreSteps = options.maxNoScoreSteps ?? DEFAULT_EPISODE_CONFIG.maxNoScoreSteps;
    this.rewardConfig = {
      ...DEFAULT_REWARD_CONFIG,
      ...(options.rewardConfig || {}),
    };
    this.defaultSeed = options.seed ?? 1;
    this.steps = 0;
    this.stepsSinceScore = 0;
    this.game = new PyoroWebGame({
      headless: true,
      selectedMode: this.modeId,
      seed: this.defaultSeed,
    });
  }

  currentMode() {
    return this.game.currentMode();
  }

  observationSize() {
    return this.game.policyObservationSize();
  }

  reset(seed = this.defaultSeed) {
    this.defaultSeed = seed;
    this.steps = 0;
    this.stepsSinceScore = 0;
    this.game.setSeed(seed);
    this.game.startNewRun(this.modeId);
    return this.game.buildPolicyObservation();
  }

  step(actionIndex = 0) {
    const scoreBefore = this.game.score;
    const holesBefore = this.game.holeCount();

    this.game.runFixedStep(actionIndex, this.fixedStep);
    this.steps += 1;

    const scoreAfter = this.game.score;
    const holesAfter = this.game.holeCount();
    const totalTiles = Math.max(this.game.cases.length, 1);
    const availableTiles = totalTiles - holesAfter;
    const availableTileFraction = availableTiles / totalTiles;
    const scoreDelta = scoreAfter - scoreBefore;
    const holeDelta = holesAfter - holesBefore;
    const dead = Boolean(this.game.pyoro?.dead);
    this.stepsSinceScore = scoreDelta > 0 ? 0 : this.stepsSinceScore + 1;

    const noScoreTimeout = this.maxNoScoreSteps > 0 && this.stepsSinceScore >= this.maxNoScoreSteps;
    const maxStepsReached = this.steps >= this.maxSteps;
    const done = dead || this.game.gameOver || maxStepsReached || noScoreTimeout;

    let reward = scoreDelta * this.rewardConfig.scoreScale;
    if (holeDelta > 0) {
      reward -= holeDelta * this.rewardConfig.holePenalty;
    } else if (holeDelta < 0) {
      reward += -holeDelta * this.rewardConfig.repairReward;
    }
    reward -= (1 - availableTileFraction) * this.rewardConfig.floorDamagePenaltyOverTime;
    if (dead) {
      reward -= this.rewardConfig.deathPenalty;
    } else if (noScoreTimeout) {
      reward -= this.rewardConfig.noScoreTimeoutPenalty;
    } else if (!done) {
      reward += this.rewardConfig.survivalReward;
    }

    let doneReason = "running";
    if (dead) {
      doneReason = "dead";
    } else if (this.game.gameOver) {
      doneReason = "game_over";
    } else if (noScoreTimeout) {
      doneReason = "no_score_timeout";
    } else if (maxStepsReached) {
      doneReason = "max_steps";
    }

    return {
      observation: this.game.buildPolicyObservation(),
      reward,
      done,
      info: {
        modeKey: this.currentMode().key,
        steps: this.steps,
        score: this.game.score,
        holes: holesAfter,
        availableTiles,
        availableTileFraction,
        speed: this.game.speed,
        dead,
        gameOver: this.game.gameOver,
        scoreDelta,
        holeDelta,
        stepsSinceScore: this.stepsSinceScore,
        noScoreTimeout,
        doneReason,
      },
    };
  }
}
