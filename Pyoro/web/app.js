import { ACTION_DEFINITIONS } from "./agent-policy.js";
import { heuristicDecisionForGame, reachableRange } from "./heuristic-policy.js";

const CONFIG = Object.freeze({
  worldWidth: 32,
  worldHeight: 18,
  unit: 40,
  maxFrameDelta: 0.05,
  speedAcceleration: 0.01,
  backgroundTransitionDuration: 3,
  backgroundAnimatedDuration: 1,
  beanFrequency: 2,
  beanSpeed: 1.8,
  beanSpriteDuration: 0.2,
  pyoroSpeed: 25,
  pyoroDieSpeed: 2,
  pyoroNotchDuration: 0.01,
  pyoroEatingDuration: 0.04,
  pyoro2ShootDuration: 0.1,
  tongueSpeed: 25,
  angelSpeed: 35,
  angelSpriteDuration: 0.5,
  seedSpeed: 45,
  airResistance: 25,
  leafSpeed: 1.5,
  leafSpriteDuration: 0.2,
  leafWindSpeed: 15,
  smokeSpriteDuration: 0.2,
  scorePopupBlinkDuration: 0.05,
  scorePopupLife: 0.3,
});

const STORAGE_KEY = "pyoro-web-save-v2";
const LEGACY_HIGH_SCORE_KEY = "pyoro-web-high-score";

const GAME_MODES = Object.freeze([
  {
    id: 0,
    key: "pyoro1",
    label: "Pyoro",
    backgroundSet: 1,
    description: "Catch falling beans with Pyoro's diagonal tongue.",
    scoring:
      "Score more by catching beans higher in the sky. Pink beans repair a hole and super beans repair many holes while clearing the sky.",
    risk: "Missing beans breaks the floor, and a bean hitting Pyoro ends the run.",
  },
  {
    id: 1,
    key: "pyoro2",
    label: "Pyoro 2",
    backgroundSet: 2,
    description: "Spit a seed diagonally to pop beans out of the air instead of using a tongue.",
    scoring:
      "Each extra bean popped by the same seed is worth more: 50, 100, 300, then 1000 points.",
    risk: "Pink and super beans still keep their repair and chain-reaction effects, but dropped beans can still destroy the floor or hit Pyoro.",
  },
]);

const POLICY_TOP_BEAN_COUNT = 8;
const POLICY_SPECIAL_FEATURE_COUNT = 15;

const SOUND_MANIFEST = Object.freeze({
  angel_down: "src/data/audio/sounds/angel_down.wav",
  bean_cut: "src/data/audio/sounds/bean_cut.wav",
  bean_explode: "src/data/audio/sounds/bean_explode.wav",
  bean_implode: "src/data/audio/sounds/bean_implode.wav",
  pyoro_die: "src/data/audio/sounds/pyoro_die.wav",
  pyoro_eat: "src/data/audio/sounds/pyoro_eat.wav",
  pyoro_move: "src/data/audio/sounds/pyoro_move.wav",
  tongue: "src/data/audio/sounds/tongue.wav",
});

const MUSIC_MANIFEST = Object.freeze({
  intro: "src/data/audio/musics/intro.wav",
  music_0: "src/data/audio/musics/music_0.wav",
  music_1: "src/data/audio/musics/music_1.wav",
  music_2: "src/data/audio/musics/music_2.wav",
  drums: "src/data/audio/musics/drums.wav",
  organ: "src/data/audio/musics/organ.wav",
  speed_drums: "src/data/audio/musics/speed_drums.wav",
  game_over: "src/data/audio/musics/game_over.wav",
});

function buildImageManifest() {
  const manifest = {};

  for (let backgroundSet = 1; backgroundSet <= 2; backgroundSet += 1) {
    for (let index = 0; index <= 20; index += 1) {
      manifest[`background_${backgroundSet}_${index}`] =
        `src/data/images/level/background ${backgroundSet}/background_${index}.png`;
    }
  }

  for (let style = 0; style <= 2; style += 1) {
    manifest[`block_${style}`] = `src/data/images/level/block/block_${style}.png`;
    manifest[`seed_${style}`] = `src/data/images/entities/seed/seed_${style}.png`;

    for (const direction of [-1, 1]) {
      manifest[`tongue_${style}_${direction}`] =
        `src/data/images/entities/tongue/tongue_${style}_${direction}.png`;

      for (const state of ["normal", "jump", "die"]) {
        manifest[`pyoro_${style}_${state}_${direction}`] =
          `src/data/images/entities/pyoro 1/pyoro_${style}_${state}_${direction}.png`;
        manifest[`pyoro2_${style}_${state}_${direction}`] =
          `src/data/images/entities/pyoro 2/pyoro_${style}_${state}_${direction}.png`;
      }

      for (const mouth of [0, 1]) {
        manifest[`pyoro_${style}_eat_${mouth}_${direction}`] =
          `src/data/images/entities/pyoro 1/pyoro_${style}_eat_${mouth}_${direction}.png`;
      }

      for (let frame = 0; frame <= 3; frame += 1) {
        manifest[`pyoro2_${style}_shoot_${frame}_${direction}`] =
          `src/data/images/entities/pyoro 2/pyoro_${style}_shoot_${frame}_${direction}.png`;
      }
    }

    for (let frame = 0; frame <= 2; frame += 1) {
      manifest[`bean_${style}_${frame}`] =
        `src/data/images/entities/bean/bean_${style}_${frame}.png`;
      manifest[`pink_bean_${style}_${frame}`] =
        `src/data/images/entities/pink bean/bean_${style}_${frame}.png`;
      manifest[`leaf_normal_${style}_${frame}`] =
        `src/data/images/entities/leaf/leaf_${style}_${frame}.png`;
      manifest[`leaf_pink_${style}_${frame}`] =
        `src/data/images/entities/pink leaf/leaf_${style}_${frame}.png`;
      manifest[`leaf_super_${style}_${frame}`] =
        `src/data/images/entities/super leaf/leaf_${style}_${frame}.png`;
      manifest[`leafpiece_normal_${style}_${frame}`] =
        `src/data/images/entities/leaf piece/leafpiece_${style}_${frame}.png`;
      manifest[`leafpiece_pink_${style}_${frame}`] =
        `src/data/images/entities/pink leaf piece/leafpiece_${style}_${frame}.png`;
      manifest[`leafpiece_super_${style}_${frame}`] =
        `src/data/images/entities/super leaf piece/leafpiece_${style}_${frame}.png`;
    }

    for (let frame = 0; frame <= 1; frame += 1) {
      manifest[`angel_${style}_${frame}`] =
        `src/data/images/entities/angel/angel_${style}_${frame}.png`;
    }

    for (let frame = 0; frame <= 2; frame += 1) {
      manifest[`smoke_${style}_${frame}`] =
        `src/data/images/entities/smoke/smoke_${style}_${frame}.png`;
    }
  }

  for (let sprite = 0; sprite <= 2; sprite += 1) {
    for (let frame = 0; frame <= 5; frame += 1) {
      manifest[`super_bean_${sprite}_${frame}`] =
        `src/data/images/entities/super bean/bean_${sprite}_${frame}.png`;
    }
  }

  manifest.menu_title = "src/data/images/gui/title.png";
  manifest.menu_frame = "src/data/images/gui/frame.png";
  for (const gameNumber of [1, 2]) {
    for (const state of ["", "_hover", "_click"]) {
      manifest[`play_button_${gameNumber}${state}`] =
        `src/data/images/gui/play button ${gameNumber}/play_button${state}.png`;
    }
  }
  for (const state of ["", "_hover", "_click"]) {
    manifest[`menu_button${state}`] = `src/data/images/gui/button/button${state}.png`;
    // The upstream art is named the opposite of how it reads: the
    // "desactivated" sprite visually shows the switch in the ON position.
    manifest[`switch_on${state}`] =
      `src/data/images/gui/switch button/switch_desactivated${state}.png`;
    manifest[`switch_off${state}`] =
      `src/data/images/gui/switch button/switch_activated${state}.png`;
  }

  return manifest;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function choice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function formatScore(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function normalizeSeed(value = Date.now()) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return ((Number.isFinite(parsed) ? parsed : 1) >>> 0) || 1;
}

function createSeededRandom(seed = Date.now()) {
  let state = normalizeSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function browserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage ?? null;
  } catch (_error) {
    return null;
  }
}

function createStubClassList() {
  return {
    add() {},
    remove() {},
    toggle() {
      return false;
    },
  };
}

function createStubElement() {
  return {
    textContent: "",
    disabled: false,
    classList: createStubClassList(),
    setAttribute() {},
    addEventListener() {},
    getAttribute() {
      return null;
    },
  };
}

async function fetchAudioObjectUrl(source) {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Unable to load audio asset: ${source}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

function waitForAudioReady(audio) {
  return new Promise((resolve, reject) => {
    if (audio.readyState >= 2) {
      resolve(audio);
      return;
    }

    const cleanup = () => {
      audio.removeEventListener("loadeddata", onReady);
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("error", onError);
    };

    const onReady = () => {
      cleanup();
      resolve(audio);
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Unable to prepare audio element for ${audio.currentSrc || audio.src}`));
    };

    audio.addEventListener("loadeddata", onReady, { once: true });
    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.load();
  });
}

async function createPreparedAudio(objectUrl, options = {}) {
  const audio = new Audio(objectUrl);
  audio.preload = "auto";
  audio.loop = options.loop ?? false;
  // The original resamples audio when the game speeds it up, so pitch should
  // rise with playback rate instead of being time-stretched.
  audio.preservesPitch = false;
  audio.webkitPreservesPitch = false;
  return waitForAudioReady(audio);
}

function toNonNegativeInt(value) {
  const number = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function defaultSaveState() {
  return {
    selectedMode: 0,
    soundEnabled: false,
    musicEnabled: false,
    stretchFullscreen: false,
    highScores: {
      pyoro1: 0,
      pyoro2: 0,
    },
  };
}

function sanitizeSaveState(raw) {
  const defaults = defaultSaveState();
  const storage = browserStorage();
  const legacyHighScore = toNonNegativeInt(
    raw?.highScore ?? raw?.high_score ?? storage?.getItem(LEGACY_HIGH_SCORE_KEY),
  );
  const highScores = raw?.highScores && typeof raw.highScores === "object"
    ? raw.highScores
    : {};
  const pyoro1HighScore = Math.max(
    legacyHighScore,
    toNonNegativeInt(highScores.pyoro1 ?? highScores.classic ?? defaults.highScores.pyoro1),
  );
  const pyoro2HighScore = toNonNegativeInt(
    highScores.pyoro2 ?? highScores.advanced ?? defaults.highScores.pyoro2,
  );

  const selectedMode = raw?.selectedMode === 1 ? 1 : 0;

  return {
    selectedMode,
    soundEnabled: Boolean(raw?.soundEnabled),
    musicEnabled: Boolean(raw?.musicEnabled),
    stretchFullscreen: Boolean(raw?.stretchFullscreen ?? raw?.stretchToFill),
    highScores: {
      pyoro1: pyoro1HighScore,
      pyoro2: pyoro2HighScore,
    },
  };
}

function readSaveState() {
  const storage = browserStorage();
  if (!storage) {
    return sanitizeSaveState({});
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      return sanitizeSaveState(JSON.parse(raw));
    }
  } catch (_error) {
    return sanitizeSaveState({});
  }

  return sanitizeSaveState({});
}

function writeSaveState(saveState) {
  const storage = browserStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(saveState));
  } catch (_error) {
    return;
  }
}

class AssetStore {
  constructor(manifest) {
    this.manifest = manifest;
    this.images = new Map();
  }

  async load() {
    const entries = Object.entries(this.manifest);

    await Promise.all(
      entries.map(([key, source]) => new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
          this.images.set(key, image);
          resolve();
        };
        image.onerror = () => {
          reject(new Error(`Unable to load image asset: ${source}`));
        };
        image.src = source;
      })),
    );
  }

  get(key) {
    return this.images.get(key) || null;
  }
}

class SilentAssetStore {
  async load() {}

  get() {
    return null;
  }
}

class SilentAudioBank {
  constructor(enabled = false) {
    this.enabled = enabled;
  }

  async preload() {}

  async unlock() {
    return true;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  play() {
    return null;
  }

  pause() {}

  resume() {
    return null;
  }

  setPlaybackRate() {}

  stop() {}
}

class SilentMusicBank {
  constructor(enabled = false) {
    this.enabled = enabled;
  }

  async preload() {}

  async unlock() {
    return true;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  stopAll() {}

  pauseAll() {}

  resumeAll() {}

  playLoop() {
    return null;
  }

  stop() {}

  isPlaying() {
    return false;
  }

  currentTime() {
    return 0;
  }

  setPlaybackRate() {}

  playOneShot() {
    return null;
  }
}

class SilentProceduralSfxBank {
  constructor(enabled = false) {
    this.enabled = enabled;
  }

  async preload() {}

  async unlock() {
    return true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  playLoop() {
    return null;
  }

  pauseLoop() {}

  stopLoop() {}

  playPyoro2Shoot() {
    return false;
  }

  playAngelChime() {
    return false;
  }

  playBuffer() {
    return false;
  }
}

class AudioBank {
  constructor(manifest, enabled = false) {
    this.manifest = manifest;
    this.enabled = enabled;
    this.sources = new Map();
    this.activeInstances = new Set();
    this.unlocked = false;
  }

  async preload(poolSize = 4) {
    await Promise.all(
      Object.entries(this.manifest).map(async ([name, source]) => {
        const objectUrl = await fetchAudioObjectUrl(source);
        const pool = await Promise.all(
          Array.from({ length: poolSize }, () => createPreparedAudio(objectUrl)),
        );
        this.sources.set(name, {
          objectUrl,
          pool,
          nextIndex: 0,
        });
      }),
    );
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      for (const audio of this.activeInstances) {
        audio.pause();
        audio.currentTime = 0;
      }
      this.activeInstances.clear();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  async unlock() {
    if (this.unlocked || !this.sources.size) {
      this.unlocked = true;
      return true;
    }

    const entry = this.sources.values().next().value;
    if (!entry || !entry.pool.length) {
      this.unlocked = true;
      return true;
    }

    try {
      const probe = entry.pool[0];
      const previousVolume = probe.volume;
      probe.volume = 0;
      await probe.play();
      probe.pause();
      probe.currentTime = 0;
      probe.volume = previousVolume;
      this.unlocked = true;
      return true;
    } catch (_error) {
      return false;
    }
  }

  play(name, options = {}) {
    if (!this.enabled || !this.sources.has(name)) {
      return null;
    }

    const entry = this.sources.get(name);
    const available = entry.pool.find((audio) => audio.paused || audio.ended) || entry.pool[entry.nextIndex];
    entry.nextIndex = (entry.nextIndex + 1) % entry.pool.length;

    available.pause();
    available.currentTime = 0;
    available.volume = options.volume ?? 1;
    available.playbackRate = options.playbackRate ?? 1;
    available.loop = options.loop ?? false;
    available.onended = () => {
      this.activeInstances.delete(available);
    };
    available.onerror = () => {
      this.activeInstances.delete(available);
    };
    this.activeInstances.add(available);
    available.play().catch(() => {});
    return available;
  }

  pause(audio) {
    if (!audio) {
      return;
    }

    audio.pause();
  }

  resume(audio, options = {}) {
    if (!audio || !this.enabled) {
      return null;
    }

    audio.volume = options.volume ?? audio.volume ?? 1;
    audio.playbackRate = options.playbackRate ?? audio.playbackRate ?? 1;
    audio.loop = options.loop ?? audio.loop ?? false;
    this.activeInstances.add(audio);
    audio.play().catch(() => {});
    return audio;
  }

  setPlaybackRate(rate) {
    for (const audio of this.activeInstances) {
      audio.playbackRate = rate;
    }
  }

  stop(audio) {
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    this.activeInstances.delete(audio);
  }
}

class MusicBank {
  constructor(manifest, enabled = false) {
    this.manifest = manifest;
    this.enabled = enabled;
    this.tracks = new Map();
    this.activeTracks = new Map();
    this.oneShotInstances = new Set();
    this.context = null;
    this.masterGain = null;
    this.unlocked = false;
  }

  ensureContext() {
    if (this.context) {
      return this.context;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }

    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.context.destination);
    return this.context;
  }

  async preload() {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    await Promise.all(
      Object.entries(this.manifest).map(async ([name, source]) => {
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`Unable to load audio asset: ${source}`);
        }

        const encoded = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(encoded.slice(0));
        this.tracks.set(name, {
          buffer,
          duration: buffer.duration,
        });
      }),
    );
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAll();
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  async unlock() {
    const context = this.ensureContext();
    if (this.unlocked || !context) {
      this.unlocked = true;
      return true;
    }

    try {
      if (context.state === "suspended") {
        await context.resume();
      }
      this.unlocked = true;
      return true;
    } catch (_error) {
      return false;
    }
  }

  normalizeOffset(name, offset = 0) {
    const track = this.tracks.get(name);
    if (!track || !track.duration) {
      return 0;
    }

    if (!Number.isFinite(offset)) {
      return 0;
    }

    const value = offset % track.duration;
    return value < 0 ? value + track.duration : value;
  }

  syncTrackState(state, referenceTime = this.context?.currentTime ?? 0) {
    if (!state || state.paused || !state.source) {
      return state?.currentOffset ?? 0;
    }

    const elapsed = Math.max(0, referenceTime - state.lastContextTime);
    if (elapsed > 0) {
      state.currentOffset = this.normalizeOffset(
        state.name,
        state.currentOffset + elapsed * state.playbackRate,
      );
      state.lastContextTime = referenceTime;
    }

    return state.currentOffset;
  }

  destroyLoopSource(state) {
    if (!state?.source) {
      return;
    }

    const { source, gainNode } = state;
    source.onended = null;
    try {
      source.stop();
    } catch (_error) {
      // Source may have already ended.
    }
    source.disconnect();
    gainNode?.disconnect();
    state.source = null;
    state.gainNode = null;
  }

  startLoopSource(name, state) {
    const context = this.ensureContext();
    const track = this.tracks.get(name);
    if (!context || !track || !this.masterGain) {
      return null;
    }

    const source = context.createBufferSource();
    const gainNode = context.createGain();

    source.buffer = track.buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = track.duration;
    source.playbackRate.value = state.playbackRate;
    gainNode.gain.value = state.volume;

    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    state.source = source;
    state.gainNode = gainNode;
    state.lastContextTime = context.currentTime;
    state.paused = false;

    source.start(context.currentTime, state.currentOffset);
    return state;
  }

  stopAll() {
    for (const state of this.activeTracks.values()) {
      this.destroyLoopSource(state);
    }
    this.activeTracks.clear();
    for (const instance of this.oneShotInstances) {
      instance.source.onended = null;
      try {
        instance.source.stop();
      } catch (_error) {
        // Source may have already ended.
      }
      instance.source.disconnect();
      instance.gainNode.disconnect();
    }
    this.oneShotInstances.clear();
  }

  pauseAll() {
    for (const state of this.activeTracks.values()) {
      if (state.paused) {
        continue;
      }

      this.syncTrackState(state);
      state.paused = true;
      this.destroyLoopSource(state);
    }
  }

  resumeAll() {
    if (!this.enabled) {
      return;
    }

    for (const [name, state] of this.activeTracks.entries()) {
      if (!state.paused) {
        continue;
      }

      this.startLoopSource(name, state);
    }
  }

  playLoop(name, options = {}) {
    if (!this.enabled || !this.tracks.has(name)) {
      return null;
    }

    let state = this.activeTracks.get(name);
    if (state) {
      if (!state.paused) {
        this.syncTrackState(state);
      }

      state.volume = options.volume ?? state.volume;
      state.playbackRate = options.playbackRate ?? state.playbackRate;

      if (options.startAt !== undefined) {
        state.currentOffset = this.normalizeOffset(name, options.startAt);
        this.destroyLoopSource(state);
        return this.startLoopSource(name, state);
      }

      if (state.source) {
        state.source.playbackRate.value = state.playbackRate;
        if (state.gainNode) {
          state.gainNode.gain.value = state.volume;
        }
        return state;
      }

      return this.startLoopSource(name, state);
    }

    state = {
      name,
      source: null,
      gainNode: null,
      currentOffset: this.normalizeOffset(name, options.startAt ?? 0),
      lastContextTime: this.context?.currentTime ?? 0,
      volume: options.volume ?? 0.35,
      playbackRate: options.playbackRate ?? 1,
      paused: false,
    };
    this.activeTracks.set(name, state);
    return this.startLoopSource(name, state);
  }

  stop(name) {
    const state = this.activeTracks.get(name);
    if (!state) {
      return;
    }

    this.destroyLoopSource(state);
    this.activeTracks.delete(name);
  }

  isPlaying(name) {
    const state = this.activeTracks.get(name);
    return Boolean(state && !state.paused);
  }

  currentTime(name) {
    const state = this.activeTracks.get(name);
    if (!state) {
      return 0;
    }

    return this.syncTrackState(state);
  }

  setPlaybackRate(rate) {
    for (const state of this.activeTracks.values()) {
      if (!state.paused) {
        this.syncTrackState(state);
      }
      state.playbackRate = rate;
      if (state.source) {
        state.source.playbackRate.value = rate;
      }
    }
  }

  playOneShot(name, options = {}) {
    if (!this.enabled || !this.tracks.has(name)) {
      return null;
    }

    const context = this.ensureContext();
    const track = this.tracks.get(name);
    if (!context || !track || !this.masterGain) {
      return null;
    }

    const source = context.createBufferSource();
    const gainNode = context.createGain();
    source.buffer = track.buffer;
    source.loop = false;
    source.playbackRate.value = options.playbackRate ?? 1;
    gainNode.gain.value = options.volume ?? 0.35;
    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    const instance = { source, gainNode };
    const cleanup = () => {
      source.disconnect();
      gainNode.disconnect();
      this.oneShotInstances.delete(instance);
    };
    source.onended = cleanup;
    this.oneShotInstances.add(instance);
    source.start(
      context.currentTime,
      this.normalizeOffset(name, options.startAt ?? 0),
    );
    return instance;
  }
}

class ProceduralSfxBank {
  constructor(enabled = false) {
    this.enabled = enabled;
    this.context = null;
    this.masterGain = null;
    this.buffers = new Map();
    this.loopStates = new Map();
    this.unlocked = false;
  }

  ensureContext() {
    if (this.context) {
      return this.context;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }

    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.enabled ? 0.18 : 0;
    this.masterGain.connect(this.context.destination);
    return this.context;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.masterGain) {
      this.masterGain.gain.value = enabled ? 0.18 : 0;
    }
  }

  async unlock() {
    const context = this.ensureContext();
    if (!context) {
      this.unlocked = true;
      return true;
    }

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (_error) {
        return false;
      }
    }

    this.unlocked = true;
    return true;
  }

  async preload(manifest = {}) {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    await Promise.all(
      Object.entries(manifest).map(async ([name, source]) => {
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`Unable to load audio asset: ${source}`);
        }

        const encoded = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(encoded.slice(0));
        this.buffers.set(name, buffer);
      }),
    );
  }

  normalizeOffset(name, offset = 0) {
    const buffer = this.buffers.get(name);
    if (!buffer || !buffer.duration || !Number.isFinite(offset)) {
      return 0;
    }

    const value = offset % buffer.duration;
    return value < 0 ? value + buffer.duration : value;
  }

  syncLoopState(state, referenceTime = this.context?.currentTime ?? 0) {
    if (!state || state.paused || !state.source) {
      return state?.currentOffset ?? 0;
    }

    const elapsed = Math.max(0, referenceTime - state.lastContextTime);
    if (elapsed > 0) {
      state.currentOffset = this.normalizeOffset(
        state.name,
        state.currentOffset + elapsed * state.playbackRate,
      );
      state.lastContextTime = referenceTime;
    }

    return state.currentOffset;
  }

  destroyLoopSource(state) {
    if (!state?.source) {
      return;
    }

    const { source, gainNode } = state;
    source.onended = null;
    try {
      source.stop();
    } catch (_error) {
      // Source may already be stopped.
    }
    source.disconnect();
    gainNode?.disconnect();
    state.source = null;
    state.gainNode = null;
  }

  startLoopSource(name, state) {
    const context = this.ensureContext();
    const buffer = this.buffers.get(name);
    if (!context || !buffer || !this.masterGain) {
      return null;
    }

    const source = context.createBufferSource();
    const gainNode = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    source.playbackRate.value = state.playbackRate;
    gainNode.gain.value = state.gain;
    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    state.source = source;
    state.gainNode = gainNode;
    state.lastContextTime = context.currentTime;
    state.paused = false;

    source.start(context.currentTime, state.currentOffset);
    return state;
  }

  playPyoro2Shoot(playbackRate = 1) {
    if (!this.enabled) {
      return false;
    }

    const context = this.ensureContext();
    if (!context || !this.masterGain) {
      return false;
    }

    const schedule = () => {
      const now = context.currentTime;
      const tone = context.createOscillator();
      const toneGain = context.createGain();
      const chirp = context.createOscillator();
      const chirpGain = context.createGain();
      const rate = clamp(playbackRate, 0.8, 2);

      tone.type = "square";
      tone.frequency.setValueAtTime(920 * rate, now);
      tone.frequency.exponentialRampToValueAtTime(460 * rate, now + 0.085);
      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.exponentialRampToValueAtTime(0.045, now + 0.004);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
      tone.connect(toneGain);
      toneGain.connect(this.masterGain);

      chirp.type = "triangle";
      chirp.frequency.setValueAtTime(1380 * rate, now);
      chirp.frequency.exponentialRampToValueAtTime(720 * rate, now + 0.045);
      chirpGain.gain.setValueAtTime(0.0001, now);
      chirpGain.gain.exponentialRampToValueAtTime(0.015, now + 0.002);
      chirpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      chirp.connect(chirpGain);
      chirpGain.connect(this.masterGain);

      const cleanup = () => {
        tone.disconnect();
        toneGain.disconnect();
        chirp.disconnect();
        chirpGain.disconnect();
      };

      chirp.onended = cleanup;
      tone.start(now);
      chirp.start(now);
      chirp.stop(now + 0.05);
      tone.stop(now + 0.09);
    };

    if (context.state === "running") {
      schedule();
      return true;
    }

    context.resume().then(schedule).catch(() => {});
    return true;
  }

  playAngelChime(playbackRate = 1) {
    if (!this.enabled) {
      return false;
    }

    const context = this.ensureContext();
    if (!context || !this.masterGain) {
      return false;
    }

    const schedule = () => {
      // A soft ascending harp-like arpeggio for the angel placing a block.
      const rate = clamp(playbackRate, 0.8, 2);
      const start = context.currentTime;
      const notes = [880, 1108.73, 1318.51, 1760];

      notes.forEach((frequency, index) => {
        const noteStart = start + index * 0.07;
        const tone = context.createOscillator();
        const toneGain = context.createGain();

        tone.type = "triangle";
        tone.frequency.setValueAtTime(frequency * rate, noteStart);
        toneGain.gain.setValueAtTime(0.0001, noteStart);
        toneGain.gain.exponentialRampToValueAtTime(0.32, noteStart + 0.012);
        toneGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.24);
        tone.connect(toneGain);
        toneGain.connect(this.masterGain);
        tone.onended = () => {
          tone.disconnect();
          toneGain.disconnect();
        };
        tone.start(noteStart);
        tone.stop(noteStart + 0.26);
      });
    };

    if (context.state === "running") {
      schedule();
      return true;
    }

    context.resume().then(schedule).catch(() => {});
    return true;
  }

  playBuffer(name, options = {}) {
    if (!this.enabled) {
      return false;
    }

    const context = this.ensureContext();
    const buffer = this.buffers.get(name);
    if (!context || !buffer || !this.masterGain) {
      return false;
    }

    const schedule = () => {
      const source = context.createBufferSource();
      const gain = context.createGain();

      source.buffer = buffer;
      source.playbackRate.value = options.playbackRate ?? 1;
      gain.gain.value = options.gain ?? 1;

      source.connect(gain);
      gain.connect(this.masterGain);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start();
    };

    if (context.state === "running") {
      schedule();
      return true;
    }

    context.resume().then(schedule).catch(() => {});
    return true;
  }

  playLoop(name, options = {}) {
    if (!this.enabled) {
      return null;
    }

    const buffer = this.buffers.get(name);
    if (!buffer) {
      return null;
    }

    let state = this.loopStates.get(name);
    if (state) {
      if (!state.paused) {
        this.syncLoopState(state);
      }

      state.gain = options.gain ?? state.gain;
      state.playbackRate = options.playbackRate ?? state.playbackRate;

      if (state.source) {
        state.source.playbackRate.value = state.playbackRate;
        if (state.gainNode) {
          state.gainNode.gain.value = state.gain;
        }
        return state;
      }

      return this.startLoopSource(name, state);
    }

    state = {
      name,
      source: null,
      gainNode: null,
      currentOffset: this.normalizeOffset(name, options.startAt ?? 0),
      lastContextTime: this.context?.currentTime ?? 0,
      gain: options.gain ?? 1,
      playbackRate: options.playbackRate ?? 1,
      paused: false,
    };
    this.loopStates.set(name, state);
    return this.startLoopSource(name, state);
  }

  pauseLoop(name) {
    const state = this.loopStates.get(name);
    if (!state || state.paused) {
      return;
    }

    this.syncLoopState(state);
    state.paused = true;
    this.destroyLoopSource(state);
  }

  stopLoop(name) {
    const state = this.loopStates.get(name);
    if (!state) {
      return;
    }

    this.destroyLoopSource(state);
    this.loopStates.delete(name);
  }
}

class Scheduler {
  constructor() {
    this.events = [];
  }

  clear() {
    this.events = [];
  }

  schedule(delay, callback) {
    const event = {
      remaining: delay,
      callback,
      cancelled: false,
    };

    this.events.push(event);
    return event;
  }

  cancel(event) {
    if (event) {
      event.cancelled = true;
    }
  }

  update(deltaTime) {
    const activeEvents = this.events;
    this.events = [];

    for (const event of activeEvents) {
      if (event.cancelled) {
        continue;
      }

      event.remaining -= deltaTime;
      if (event.remaining <= 0) {
        event.callback();
      } else {
        this.events.push(event);
      }
    }
  }
}

class Entity {
  constructor(game, x, y, width, height) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.removed = false;
  }

  get left() {
    return this.x - this.width / 2;
  }

  get right() {
    return this.x + this.width / 2;
  }

  get top() {
    return this.y - this.height / 2;
  }

  get bottom() {
    return this.y + this.height / 2;
  }

  intersects(other) {
    return (
      other.right > this.left &&
      other.left < this.right &&
      other.bottom > this.top &&
      other.top < this.bottom
    );
  }

  isOutOfBounds(included = true) {
    const { worldWidth, worldHeight } = CONFIG;

    if (included) {
      return (
        this.right <= 0 ||
        this.left >= worldWidth ||
        this.bottom <= 0 ||
        this.top >= worldHeight
      );
    }

    return (
      this.left <= 0 ||
      this.right >= worldWidth ||
      this.top <= 0 ||
      this.bottom >= worldHeight
    );
  }

  hitsFloor() {
    return this.bottom >= CONFIG.worldHeight - 1;
  }

  remove() {
    this.removed = true;
  }
}

class Leaf extends Entity {
  constructor(game, x, y, speed, variant, velocity = 0) {
    super(game, x, y, 0.75, 0.75);
    this.variant = variant;
    this.speed = speed;
    this.velocity = velocity;
    this.spriteTimer = 0;
    this.spriteFrame = 0;
  }

  update(deltaTime) {
    this.spriteTimer += deltaTime;
    while (this.spriteTimer >= CONFIG.leafSpriteDuration) {
      this.spriteTimer -= CONFIG.leafSpriteDuration;
      this.spriteFrame = (this.spriteFrame + 1) % 3;
    }

    this.x += this.velocity * deltaTime;
    this.y += (CONFIG.leafSpeed - Math.abs(this.velocity)) * this.speed * deltaTime;

    if (this.velocity > 0) {
      this.velocity = Math.max(0, this.velocity - CONFIG.airResistance * deltaTime);
    } else if (this.velocity < 0) {
      this.velocity = Math.min(0, this.velocity + CONFIG.airResistance * deltaTime);
    }

    if (this.isOutOfBounds()) {
      this.remove();
    }
  }

  setLeftWind() {
    this.velocity = -CONFIG.leafWindSpeed;
  }

  setRightWind() {
    this.velocity = CONFIG.leafWindSpeed;
  }

  cut() {
    if (Math.floor(this.game.randomRange(0, 3)) !== 0) {
      return;
    }

    for (const deltaPosition of [-this.width, this.width]) {
      this.game.leaves.push(
        new LeafPiece(
          this.game,
          this.x + deltaPosition / 2,
          this.y,
          this.speed,
          this.variant,
          this.velocity / 2,
        ),
      );
    }

    this.remove();
  }

  spriteKey(style) {
    return `leaf_${this.variant}_${style}_${this.spriteFrame}`;
  }

  draw(context) {
    const image = this.game.assets.get(this.spriteKey(this.game.styleType()));
    if (!image) {
      return;
    }

    this.game.drawCenteredImage(context, image, this.x, this.y, this.width, this.height);
  }
}

class LeafPiece extends Leaf {
  spriteKey(style) {
    return `leafpiece_${this.variant}_${style}_${this.spriteFrame}`;
  }

  cut() {}
}

class Bean extends Entity {
  constructor(game, type, x, y, speedMultiplier) {
    super(game, x, y, 1.5, 1.5);
    this.type = type;
    this.speedMultiplier = speedMultiplier;
    this.caught = false;
    this.spriteTimer = 0;
    this.spriteFrame = 0;
    this.superFrame = 0;
    this.superColorFrame = 0;
  }

  update(deltaTime) {
    this.advanceAnimation(deltaTime);

    if (this.caught || this.removed) {
      return;
    }

    this.y += CONFIG.beanSpeed * this.speedMultiplier * deltaTime;

    if (this.hitsFloor()) {
      const tileIndex = clamp(Math.floor(this.x), 0, CONFIG.worldWidth - 1);
      const tile = this.game.cases[tileIndex];

      if (tile.exists) {
        tile.exists = false;
        this.game.playSound("bean_explode");
        this.game.spawnSmoke(this.x, this.y);
        this.remove();
        return;
      }
    }

    if (!this.game.pyoro.dead && this.intersects(this.game.pyoro)) {
      this.game.playSound("bean_explode");
      this.game.spawnSmoke(this.x, this.y);
      this.remove();
      this.game.pyoro.die();
      return;
    }

    if (this.isOutOfBounds()) {
      this.remove();
    }
  }

  advanceAnimation(deltaTime) {
    this.spriteTimer += deltaTime;

    if (this.type === "super") {
      const step = CONFIG.beanSpriteDuration / 6;
      while (this.spriteTimer >= step) {
        this.spriteTimer -= step;
        this.superColorFrame = (this.superColorFrame + 1) % 6;
        if (this.superColorFrame % 2 === 0) {
          this.superFrame = (this.superFrame + 1) % 3;
        }
      }
      return;
    }

    while (this.spriteTimer >= CONFIG.beanSpriteDuration) {
      this.spriteTimer -= CONFIG.beanSpriteDuration;
      this.spriteFrame = (this.spriteFrame + 1) % 3;
    }
  }

  catch() {
    if (this.caught || this.removed) {
      return;
    }

    this.caught = true;

    if (this.type === "pink") {
      this.game.repairCase();
    } else if (this.type === "super") {
      this.game.triggerSuperBean(this);
    }
  }

  cut(options = {}) {
    const soundName = Object.prototype.hasOwnProperty.call(options, "soundName")
      ? options.soundName
      : "bean_cut";
    if (soundName) {
      this.game.playSound(soundName);
    }
    this.game.spawnLeaf(this.type, this.x, this.y);
    this.game.spawnLeaf(this.type, this.x, this.y);
  }

  spriteKey(style) {
    if (this.type === "super") {
      return `super_bean_${this.superFrame}_${this.superColorFrame}`;
    }

    if (this.type === "pink") {
      return `pink_bean_${style}_${this.spriteFrame}`;
    }

    return `bean_${style}_${this.spriteFrame}`;
  }

  draw(context) {
    const image = this.game.assets.get(this.spriteKey(this.game.styleType()));
    if (!image) {
      return;
    }

    this.game.drawCenteredImage(context, image, this.x, this.y, this.width, this.height);
  }
}

class Angel extends Entity {
  constructor(game, tileIndex) {
    super(game, tileIndex + 0.75, 0.75, 1.5, 1.5);
    this.tileIndex = tileIndex;
    this.spriteFrame = 0;
    this.spriteTimer = 0;
    // A soft multi-note chime like the DSi original; the bundled
    // angel_down.wav is a single quiet blip that never read as the
    // block-drop sound.
    this.game.playAngelChime();
  }

  update(deltaTime) {
    this.spriteTimer += deltaTime;
    while (this.spriteTimer >= CONFIG.angelSpriteDuration) {
      this.spriteTimer -= CONFIG.angelSpriteDuration;
      this.spriteFrame = this.spriteFrame === 0 ? 1 : 0;
    }

    const tile = this.game.cases[this.tileIndex];
    this.y += tile.isRepairing ? CONFIG.angelSpeed * deltaTime : -CONFIG.angelSpeed * deltaTime;

    if (tile.isRepairing && this.hitsFloor()) {
      tile.isRepairing = false;
      tile.exists = true;
    }

    if (this.isOutOfBounds()) {
      this.remove();
    }
  }

  spriteKey(style) {
    return `angel_${style}_${this.spriteFrame}`;
  }

  draw(context) {
    const image = this.game.assets.get(this.spriteKey(this.game.styleType()));
    if (!image) {
      return;
    }

    this.game.drawCenteredImage(context, image, this.x, this.y, this.width, this.height);
  }
}

class Smoke extends Entity {
  constructor(game, x, y) {
    super(game, x, y, 1.5, 1.5);
    this.age = 0;
  }

  update(deltaTime) {
    this.age += deltaTime;
    if (this.age >= CONFIG.smokeSpriteDuration * 3) {
      this.remove();
    }
  }

  spriteKey(style) {
    const frame = clamp(Math.floor(this.age / CONFIG.smokeSpriteDuration), 0, 2);
    return `smoke_${style}_${frame}`;
  }

  draw(context) {
    const image = this.game.assets.get(this.spriteKey(this.game.styleType()));
    if (!image) {
      return;
    }

    this.game.drawCenteredImage(context, image, this.x, this.y, this.width, this.height);
  }
}

class ScorePopup {
  constructor(game, x, y, value) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.value = value;
    this.age = 0;
    this.blinkTimer = 0;
    this.removed = false;
    this.highlight = true;
  }

  update(deltaTime) {
    this.age += deltaTime;
    this.blinkTimer += deltaTime;
    this.y -= 0.35 * deltaTime;

    if (this.value >= 300) {
      while (this.blinkTimer >= CONFIG.scorePopupBlinkDuration) {
        this.blinkTimer -= CONFIG.scorePopupBlinkDuration;
        this.highlight = !this.highlight;
      }
    }

    if (this.age >= CONFIG.scorePopupLife) {
      this.removed = true;
    }
  }

  draw(context) {
    const size = Math.round(CONFIG.unit * 0.75);

    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${size}px "Pyoro UI", monospace`;
    context.lineWidth = 6;
    context.strokeStyle = "rgba(0, 0, 0, 0.65)";
    context.fillStyle = this.highlight ? "#ffd54a" : "#fff8b8";
    context.strokeText(String(this.value), this.x * CONFIG.unit, this.y * CONFIG.unit);
    context.fillText(String(this.value), this.x * CONFIG.unit, this.y * CONFIG.unit);
    context.restore();
  }
}

// Pyoro 2's projectile: a single seed pellet that flies diagonally upward
// and pops every bean it touches on the way. Each successive bean hit by
// the same seed is worth more points.
class Seed extends Entity {
  constructor(game, direction) {
    const player = game.pyoro;
    const x = player.x + (player.width / 2 + 0.3) * direction;
    const y = player.y - player.height / 2 + 0.3;

    super(game, x, y, 0.5, 0.5);
    this.direction = direction;
    this.hitCount = 0;
    this.hitLeaves = new Set();
  }

  update(deltaTime) {
    this.x += CONFIG.seedSpeed * this.direction * deltaTime;
    this.y -= CONFIG.seedSpeed * deltaTime;

    for (const bean of this.game.beans) {
      if (bean.removed || bean.caught) {
        continue;
      }

      if (this.intersects(bean)) {
        this.hitCount += 1;
        bean.cut();
        bean.catch();
        bean.remove();
        this.game.addScore(this.game.comboScore(this.hitCount), bean.x, bean.y);
      }
    }

    for (const leaf of this.game.leaves) {
      if (leaf.removed || this.hitLeaves.has(leaf)) {
        continue;
      }

      if (this.intersects(leaf)) {
        this.hitLeaves.add(leaf);
        leaf.cut();
        if (this.direction === 1) {
          leaf.setRightWind();
        } else {
          leaf.setLeftWind();
        }
      }
    }

    if (this.isOutOfBounds()) {
      this.remove();
    }
  }

  draw(context) {
    const image = this.game.assets.get(`seed_${this.game.styleType()}`);
    if (!image) {
      return;
    }

    // Rendered as the original's tiny seed dot; the entity keeps a larger
    // hitbox so the fast pellet still connects fairly.
    this.game.drawCenteredImage(context, image, this.x, this.y, 0.1875, 0.1875);
  }
}

class Tongue extends Entity {
  constructor(game, direction) {
    const player = game.pyoro;
    const x = player.x + (player.width / 2 + 0.6) * direction;
    const y = player.y - player.height / 2 + 0.6;

    super(game, x, y, 1.2, 1.2);
    this.direction = direction;
    this.caughtBean = null;
    this.goBack = false;
    this.sound = this.game.playSound("tongue");
  }

  update(deltaTime) {
    if (this.goBack) {
      this.x -= CONFIG.tongueSpeed * 2 * this.direction * deltaTime;
      this.y += CONFIG.tongueSpeed * 2 * deltaTime;

      if (this.caughtBean && !this.caughtBean.removed) {
        this.caughtBean.x = this.x;
        this.caughtBean.y = this.y;
      }

      if (this.y >= this.game.pyoro.y) {
        if (this.caughtBean && !this.caughtBean.removed) {
          this.game.playSound("pyoro_eat");
          this.game.pyoro.startEating();
        }
        this.remove();
      }
      return;
    }

    this.x += CONFIG.tongueSpeed * this.direction * deltaTime;
    this.y -= CONFIG.tongueSpeed * deltaTime;

    for (const bean of this.game.beans) {
      if (bean.removed || bean.caught) {
        continue;
      }

      if (this.intersects(bean)) {
        bean.catch();
        this.game.audio.stop(this.sound);
        this.sound = null;
        this.caughtBean = bean;
        this.goBack = true;
        this.game.addScore(this.game.scoreForHeight(this.y), this.x, this.y);
        return;
      }
    }

    if (this.isOutOfBounds(false)) {
      this.goBack = true;
    }
  }

  draw(context) {
    const image = this.game.assets.get(`tongue_${this.game.styleType()}_${this.direction}`);
    if (!image) {
      return;
    }

    this.game.drawCenteredImage(context, image, this.x, this.y, this.width, this.height);
  }

  remove() {
    this.game.audio.stop(this.sound);
    this.sound = null;

    if (this.caughtBean && !this.caughtBean.removed) {
      this.caughtBean.remove();
    }

    if (this.game.pyoro.tongue === this) {
      this.game.pyoro.tongue = null;
    }

    super.remove();
  }
}

class PlayerBase extends Entity {
  constructor(game) {
    super(game, 2, CONFIG.worldHeight - 2, 2, 2);
    this.direction = 1;
    this.moving = false;
    this.dead = false;
    this.notch = false;
    this.notchTransition = null;
    this.moveSound = null;
    this.movementSoundSuppressed = false;
  }

  canStartMoving() {
    return !this.dead;
  }

  onMoveEnabled() {}

  enableMoveLeft() {
    if (!this.canStartMoving()) {
      return;
    }

    this.onMoveEnabled();
    this.direction = -1;
    this.moving = true;
    this.movementSoundSuppressed = false;
    this.syncMovementAudio(true);
  }

  enableMoveRight() {
    if (!this.canStartMoving()) {
      return;
    }

    this.onMoveEnabled();
    this.direction = 1;
    this.moving = true;
    this.movementSoundSuppressed = false;
    this.syncMovementAudio(true);
  }

  disableMove() {
    this.moving = false;
    this.notch = false;
    this.notchTransition = null;
    this.pauseMovementAudio();
  }

  updateMovementState(deltaTime, canMove = true) {
    if (!this.moving) {
      this.disableMove();
      return;
    }

    if (canMove && !this.notch) {
      this.move(deltaTime, this.direction);
      if (!this.notchTransition) {
        this.notchTransition = {
          type: "enable",
          remaining: CONFIG.pyoroNotchDuration,
        };
      }
    }

    this.updateNotchTransition(deltaTime);
    this.syncMovementAudio(canMove);
  }

  syncMovementAudio(canMove = true) {
    const shouldPlay = this.game.audio.enabled
      && this.moving
      && !this.dead
      && canMove
      && !this.movementSoundSuppressed;

    if (!shouldPlay) {
      this.pauseMovementAudio();
      return;
    }

    if (!this.moveSound) {
      this.moveSound = "pyoro_move";
    }

    this.game.proceduralSfx.playLoop(this.moveSound, {
      gain: 1,
      playbackRate: this.game.musicPlaybackRate,
    });
  }

  pauseMovementAudio() {
    if (!this.moveSound) {
      return;
    }

    this.game.proceduralSfx.pauseLoop(this.moveSound);
  }

  stopMovementAudio() {
    if (!this.moveSound) {
      return;
    }

    this.game.proceduralSfx.stopLoop(this.moveSound);
    this.moveSound = null;
  }

  updateNotchTransition(deltaTime) {
    if (!this.notchTransition) {
      return;
    }

    const transition = this.notchTransition;
    transition.remaining -= deltaTime;
    if (transition.remaining > 0) {
      return;
    }

    if (transition.type === "enable") {
      this.notch = true;
      this.notchTransition = {
        type: "disable",
        remaining: CONFIG.pyoroNotchDuration,
      };
      return;
    }

    this.notch = false;
    this.notchTransition = null;
  }

  move(deltaTime, direction) {
    const amount = CONFIG.pyoroSpeed * deltaTime;

    if (direction === 1) {
      const target = this.x + this.width / 2 + amount;
      const voidTile = this.voidTileOnPath(target);

      if (target >= CONFIG.worldWidth) {
        this.x = CONFIG.worldWidth - this.width / 2;
      } else if (voidTile !== null) {
        this.x = voidTile - this.width / 2;
      } else {
        this.x += amount;
      }
      return;
    }

    const target = this.x - this.width / 2 - amount;
    const voidTile = this.voidTileOnPath(target);

    if (target < 0) {
      this.x = this.width / 2;
    } else if (voidTile !== null) {
      this.x = voidTile + this.width / 2 + 1;
    } else {
      this.x -= amount;
    }
  }

  voidTileOnPath(targetPosition) {
    if (this.x < targetPosition) {
      const oldPosition = Math.floor(this.x + this.width / 2);
      const target = Math.min(Math.floor(targetPosition), this.game.cases.length - 1);

      for (let index = oldPosition; index <= target; index += 1) {
        if (!this.game.cases[index].exists) {
          return index;
        }
      }

      return null;
    }

    const oldPosition = Math.floor(this.x - this.width / 2 - 1);
    const target = Math.max(Math.floor(targetPosition), 0);

    for (let index = oldPosition; index >= target; index -= 1) {
      if (!this.game.cases[index].exists) {
        return index;
      }
    }

    return null;
  }

  die() {
    if (this.dead) {
      return;
    }

    this.dead = true;
    this.disableMove();
    this.stopMovementAudio();
    this.game.musicPlaybackRate = 1;
    this.game.audio.setPlaybackRate(1);
    this.game.music.setPlaybackRate(1);
    this.game.input.left = false;
    this.game.input.right = false;
    this.game.input.action = false;
    this.game.playSound("pyoro_die");
    this.game.scheduler.schedule(1.28, () => {
      this.game.finishRun();
    });
  }

  updateDeath(deltaTime) {
    if (this.top < CONFIG.worldWidth) {
      this.y += CONFIG.pyoroDieSpeed * deltaTime;
    }
  }

  draw(context) {
    const image = this.game.assets.get(this.spriteKey(this.game.styleType()));
    if (!image) {
      return;
    }

    this.game.drawCenteredImage(context, image, this.x, this.y, this.width, this.height);
  }
}

class ClassicPyoro extends PlayerBase {
  constructor(game) {
    super(game);
    this.tongue = null;
    this.eatingTicks = 0;
    this.eatingAccumulator = 0;
    this.eatingOpen = false;
  }

  update(deltaTime) {
    if (this.dead) {
      this.updateDeath(deltaTime);
      return;
    }

    this.updateEating(deltaTime);
    this.updateMovementState(deltaTime, !this.tongue);
  }

  canStartMoving() {
    return !this.dead && !this.tongue;
  }

  shoot() {
    if (this.dead) {
      return;
    }

    this.movementSoundSuppressed = true;
    this.pauseMovementAudio();
    if (this.tongue) {
      this.tongue.remove();
    }

    this.tongue = new Tongue(this.game, this.direction);
  }

  recallAbility() {
    if (!this.dead && this.tongue) {
      this.tongue.goBack = true;
    }
  }

  startEating() {
    this.eatingTicks = 8;
    this.eatingAccumulator = 0;
    this.eatingOpen = true;
  }

  updateEating(deltaTime) {
    if (this.eatingTicks <= 0) {
      this.eatingOpen = false;
      return;
    }

    this.eatingAccumulator += deltaTime;
    while (this.eatingAccumulator >= CONFIG.pyoroEatingDuration && this.eatingTicks > 0) {
      this.eatingAccumulator -= CONFIG.pyoroEatingDuration;
      this.eatingTicks -= 1;

      if (this.eatingTicks > 0) {
        this.eatingOpen = !this.eatingOpen;
      } else {
        this.eatingOpen = false;
      }
    }
  }

  die() {
    if (this.tongue) {
      this.tongue.remove();
    }

    super.die();
  }

  spriteKey(style) {
    if (this.dead) {
      return `pyoro_${style}_die_${this.direction}`;
    }

    if (this.tongue) {
      return `pyoro_${style}_eat_1_${this.direction}`;
    }

    if (this.notch) {
      return `pyoro_${style}_jump_${this.direction}`;
    }

    if (this.eatingTicks > 0 && this.eatingOpen) {
      return `pyoro_${style}_eat_0_${this.direction}`;
    }

    return `pyoro_${style}_normal_${this.direction}`;
  }
}

class Pyoro2 extends PlayerBase {
  constructor(game) {
    super(game);
    this.shootFrame = 0;
    this.shootAccumulator = 0;
  }

  update(deltaTime) {
    if (this.dead) {
      this.updateDeath(deltaTime);
      return;
    }

    this.updateShootAnimation(deltaTime);
    this.updateMovementState(deltaTime);
  }

  onMoveEnabled() {
    if (this.shootFrame > 0) {
      this.shootFrame = 0;
      this.shootAccumulator = 0;
    }
  }

  updateShootAnimation(deltaTime) {
    if (this.shootFrame <= 0) {
      return;
    }

    this.shootAccumulator += deltaTime;
    while (this.shootAccumulator >= CONFIG.pyoro2ShootDuration && this.shootFrame > 0) {
      this.shootAccumulator -= CONFIG.pyoro2ShootDuration;
      this.shootFrame += 1;
      if (this.shootFrame > 4) {
        this.shootFrame = 0;
      }
    }
  }

  shoot() {
    if (this.dead) {
      return;
    }

    this.game.playPyoro2Shoot();
    this.shootFrame = 1;
    this.shootAccumulator = 0;
    this.game.spawnSeed(this.direction);
  }

  recallAbility() {}

  isShootingEntity(entity) {
    const distance = this.direction === 1 ? entity.x - this.x : this.x - entity.x;

    return (
      this.y - entity.y + entity.height >= distance - entity.width &&
      this.y - entity.y - entity.height <= distance + entity.width
    );
  }

  spriteKey(style) {
    if (this.dead) {
      return `pyoro2_${style}_die_${this.direction}`;
    }

    if (this.shootFrame > 0) {
      return `pyoro2_${style}_shoot_${this.shootFrame - 1}_${this.direction}`;
    }

    if (this.notch) {
      return `pyoro2_${style}_jump_${this.direction}`;
    }

    return `pyoro2_${style}_normal_${this.direction}`;
  }
}

class PyoroWebGame {
  constructor(options = {}) {
    this.headless = Boolean(options.headless || typeof document === "undefined");
    this.fixedStep = options.fixedStep ?? 1 / 60;
    this.maxSubSteps = options.maxSubSteps ?? 5;
    this.frameAccumulator = 0;
    this.seed = normalizeSeed(options.seed);
    this.rng = createSeededRandom(this.seed);

    this.canvas = this.headless
      ? { width: CONFIG.worldWidth * CONFIG.unit, height: CONFIG.worldHeight * CONFIG.unit }
      : document.getElementById("gameCanvas");
    this.context = this.headless ? null : this.canvas.getContext("2d");
    if (this.context) {
      this.context.imageSmoothingEnabled = false;
    }

    this.overlay = this.headless ? createStubElement() : document.getElementById("overlay");
    this.overlayTitle = this.headless ? createStubElement() : document.getElementById("overlayTitle");
    this.overlayMessage = this.headless ? createStubElement() : document.getElementById("overlayMessage");
    this.overlayButton = this.headless ? createStubElement() : document.getElementById("overlayButton");
    this.canvasFrame = this.headless ? createStubElement() : document.querySelector(".canvas-frame");

    this.startButton = this.headless ? createStubElement() : document.getElementById("startButton");
    this.pauseButton = this.headless ? createStubElement() : document.getElementById("pauseButton");
    this.muteButton = this.headless ? createStubElement() : document.getElementById("muteButton");
    this.musicButton = this.headless ? createStubElement() : document.getElementById("musicButton");
    this.fullscreenButton = this.headless ? createStubElement() : document.getElementById("fullscreenButton");
    this.stretchButton = this.headless ? createStubElement() : document.getElementById("stretchButton");
    this.modeClassicButton = this.headless ? createStubElement() : document.getElementById("modeClassicButton");
    this.modeAdvancedButton = this.headless ? createStubElement() : document.getElementById("modeAdvancedButton");
    this.uiPanel = this.headless ? createStubElement() : document.getElementById("uiPanel");
    this.uiToggleButton = this.headless ? createStubElement() : document.getElementById("uiToggleButton");
    this.uiCloseButton = this.headless ? createStubElement() : document.getElementById("uiCloseButton");
    this.uiPanelOpen = false;

    this.scoreValue = this.headless ? createStubElement() : document.getElementById("scoreValue");
    this.highScoreValue = this.headless ? createStubElement() : document.getElementById("highScoreValue");
    this.modeValue = this.headless ? createStubElement() : document.getElementById("modeValue");
    this.holesValue = this.headless ? createStubElement() : document.getElementById("holesValue");
    this.speedValue = this.headless ? createStubElement() : document.getElementById("speedValue");
    this.statusValue = this.headless ? createStubElement() : document.getElementById("statusValue");
    this.modeHint = this.headless ? createStubElement() : document.getElementById("modeHint");
    this.abilityTitle = this.headless ? createStubElement() : document.getElementById("abilityTitle");
    this.abilityDescription = this.headless ? createStubElement() : document.getElementById("abilityDescription");
    this.abilityScoring = this.headless ? createStubElement() : document.getElementById("abilityScoring");
    this.abilityRisk = this.headless ? createStubElement() : document.getElementById("abilityRisk");

    this.assets = this.headless ? new SilentAssetStore() : new AssetStore(buildImageManifest());
    this.assetsReady = this.headless;
    this.loopStarted = false;
    this.save = this.headless
      ? sanitizeSaveState(options.saveState ?? {})
      : readSaveState();
    if (options.selectedMode === 0 || options.selectedMode === 1) {
      this.save.selectedMode = options.selectedMode;
    }

    this.audio = this.headless
      ? new SilentAudioBank(this.save.soundEnabled)
      : new AudioBank(SOUND_MANIFEST, this.save.soundEnabled);
    this.music = this.headless
      ? new SilentMusicBank(this.save.musicEnabled)
      : new MusicBank(MUSIC_MANIFEST, this.save.musicEnabled);
    this.proceduralSfx = this.headless
      ? new SilentProceduralSfxBank(this.save.soundEnabled)
      : new ProceduralSfxBank(this.save.soundEnabled);
    this.scheduler = new Scheduler();

    this.input = {
      left: false,
      right: false,
      action: false,
      lastHorizontalDirection: 1,
    };

    this.selectedMode = this.save.selectedMode;
    this.highScores = {
      pyoro1: this.save.highScores.pyoro1,
      pyoro2: this.save.highScores.pyoro2,
    };
    this.save.highScores = this.highScores;
    this.score = 0;
    this.speed = 1;
    this.cases = [];
    this.beans = [];
    this.angels = [];
    this.popups = [];
    this.seeds = [];
    this.leaves = [];
    this.smokes = [];
    this.pyoro = null;
    this.running = false;
    this.started = false;
    this.paused = false;
    this.gameOver = false;
    this.mainMenu = false;
    this.optionsOpen = false;
    this.menuHoverId = null;
    this.menuPressedId = null;
    this.menuBotAbilityHeld = false;
    this.menuRestartPending = false;
    this.lastTimestamp = null;
    this.currentBackgroundId = 0;
    this.backgroundFade = null;
    this.animatedBackgroundId = 13;
    this.animatedAccumulator = 0;
    this.lastMusicStyleType = 0;
    this.lastMusicScore = 0;
    this.musicPlaybackRate = 1;
    this.autoPlayer = false;
    this.loop = this.loop.bind(this);
  }

  setSeed(seed = Date.now()) {
    this.seed = normalizeSeed(seed);
    this.rng = createSeededRandom(this.seed);
    return this.seed;
  }

  random() {
    return this.rng();
  }

  randomRange(min, max) {
    return min + this.random() * (max - min);
  }

  choice(values) {
    if (!values.length) {
      return null;
    }
    return values[Math.floor(this.random() * values.length)];
  }

  holeCount() {
    return this.cases.filter((tile) => !tile.exists).length;
  }

  activeBeans() {
    return this.beans.filter((bean) => !bean.removed && !bean.caught);
  }

  bestPyoro1Plan() {
    const player = this.pyoro;
    if (!(player instanceof ClassicPyoro) || player.dead) {
      return null;
    }

    const minX = player.width / 2;
    const maxX = CONFIG.worldWidth - player.width / 2;
    const floorDamage = this.holeCount() / CONFIG.worldWidth;
    let bestPlan = null;

    for (const bean of this.activeBeans()) {
      const verticalGap = player.y - 0.4 - bean.y;
      if (verticalGap <= 0) {
        continue;
      }

      const beanFallSpeed = CONFIG.beanSpeed * bean.speedMultiplier * this.speed;
      const travelTime = verticalGap / (CONFIG.tongueSpeed + beanFallSpeed);

      for (const direction of [-1, 1]) {
        const targetX = direction === 1
          ? bean.x - 1.6 - CONFIG.tongueSpeed * travelTime
          : bean.x + 1.6 + CONFIG.tongueSpeed * travelTime;

        if (targetX < minX || targetX > maxX) {
          continue;
        }

        const urgency = bean.y / CONFIG.worldHeight;
        const lateralDistance = Math.abs(targetX - player.x) / CONFIG.worldWidth;
        const typeBonus = bean.type === "super"
          ? 0.35 + floorDamage * 0.9
          : bean.type === "pink"
            ? 0.18 + floorDamage * 0.45
            : 0;
        const withinWindow = Math.abs(player.x - targetX) <= 0.65;
        const plan = {
          bean,
          direction,
          targetX,
          urgency: clamp(urgency, 0, 1),
          lateralDistance: clamp(lateralDistance, 0, 1),
          withinWindow,
          score: urgency * 2.8 + typeBonus - lateralDistance + (withinWindow ? 0.3 : 0),
        };

        if (!bestPlan || plan.score > bestPlan.score) {
          bestPlan = plan;
        }
      }
    }

    return bestPlan;
  }

  bestPyoro2Target() {
    const player = this.pyoro;
    if (!(player instanceof Pyoro2) || player.dead) {
      return null;
    }

    const floorDamage = this.holeCount() / CONFIG.worldWidth;
    const range = reachableRange(this);
    let bestTarget = null;

    for (const bean of this.activeBeans()) {
      // A bean this low can no longer be intercepted by a seed without
      // walking into it; it is a hazard, not a target.
      if (player.y - bean.y < 3) {
        continue;
      }

      const direction = bean.x >= player.x ? 1 : -1;

      // Skip beans whose firing position cannot be reached because a floor
      // hole (or the wall) blocks the path.
      const interceptX = bean.x - direction * (player.y - bean.y);
      if (interceptX < range.minX - 0.5 || interceptX > range.maxX + 0.5) {
        continue;
      }
      const aligned = player.direction === direction && player.isShootingEntity(bean);
      const urgency = bean.y / CONFIG.worldHeight;
      const lateralDistance = Math.abs(bean.x - player.x) / CONFIG.worldWidth;
      const typeBonus = bean.type === "super"
        ? 0.35 + floorDamage * 0.9
        : bean.type === "pink"
          ? 0.18 + floorDamage * 0.45
          : 0;
      const target = {
        bean,
        direction,
        aligned,
        urgency: clamp(urgency, 0, 1),
        lateralDistance: clamp(lateralDistance, 0, 1),
        score: urgency * 2.5 + typeBonus - lateralDistance + (aligned ? 0.5 : 0),
      };

      if (!bestTarget || target.score > bestTarget.score) {
        bestTarget = target;
      }
    }

    return bestTarget;
  }

  policyObservationSize() {
    return 14 + CONFIG.worldWidth * 5 + POLICY_TOP_BEAN_COUNT * 6 + POLICY_SPECIAL_FEATURE_COUNT;
  }

  buildPolicyObservation() {
    const player = this.pyoro ?? {
      x: 2,
      direction: 1,
      shootFrame: 0,
    };
    const tongue = player instanceof ClassicPyoro ? player.tongue : null;
    const holes = [];
    const repairing = [];
    const normalBeans = Array(CONFIG.worldWidth).fill(0);
    const pinkBeans = Array(CONFIG.worldWidth).fill(0);
    const superBeans = Array(CONFIG.worldWidth).fill(0);
    const activeBeans = [];

    for (let index = 0; index < CONFIG.worldWidth; index += 1) {
      const tile = this.cases[index] || { exists: true, isRepairing: false };
      holes.push(tile.exists ? 0 : 1);
      repairing.push(tile.isRepairing ? 1 : 0);
    }

    for (const bean of this.beans) {
      if (bean.removed || bean.caught) {
        continue;
      }

      const laneIndex = clamp(Math.floor(bean.x), 0, CONFIG.worldWidth - 1);
      const urgency = clamp(bean.y / CONFIG.worldHeight, 0, 1);
      const target = bean.type === "super"
        ? superBeans
        : bean.type === "pink"
          ? pinkBeans
          : normalBeans;
      target[laneIndex] = Math.max(target[laneIndex], urgency);
      activeBeans.push(bean);
    }

    activeBeans.sort((left, right) => {
      const urgencyDelta = right.y - left.y;
      if (urgencyDelta !== 0) {
        return urgencyDelta;
      }
      return Math.abs(left.x - player.x) - Math.abs(right.x - player.x);
    });

    const beanFeatures = [];
    for (let index = 0; index < POLICY_TOP_BEAN_COUNT; index += 1) {
      const bean = activeBeans[index];
      if (!bean) {
        beanFeatures.push(0, 0, 0, 0, 0, 0);
        continue;
      }

      beanFeatures.push(
        clamp((bean.x - player.x) / (CONFIG.worldWidth / 2), -1, 1),
        clamp(bean.x / CONFIG.worldWidth, 0, 1),
        clamp(bean.y / CONFIG.worldHeight, 0, 1),
        clamp(bean.speedMultiplier / 3, 0, 1),
        bean.type === "pink" ? 1 : 0,
        bean.type === "super" ? 1 : 0,
      );
    }

    const pyoro1Plan = this.bestPyoro1Plan();
    const pyoro2Target = this.bestPyoro2Target();
    const pyoro1Features = pyoro1Plan
      ? [
        1,
        pyoro1Plan.direction,
        clamp(pyoro1Plan.targetX / CONFIG.worldWidth, 0, 1),
        clamp((pyoro1Plan.targetX - player.x) / (CONFIG.worldWidth / 2), -1, 1),
        pyoro1Plan.urgency,
        pyoro1Plan.withinWindow ? 1 : 0,
        pyoro1Plan.bean.type === "pink" ? 1 : 0,
        pyoro1Plan.bean.type === "super" ? 1 : 0,
      ]
      : [0, 0, 0, 0, 0, 0, 0, 0];
    const pyoro2Features = pyoro2Target
      ? [
        1,
        pyoro2Target.direction,
        pyoro2Target.urgency,
        pyoro2Target.aligned ? 1 : 0,
        pyoro2Target.bean.type === "pink" ? 1 : 0,
        pyoro2Target.bean.type === "super" ? 1 : 0,
        clamp((pyoro2Target.bean.x - player.x) / (CONFIG.worldWidth / 2), -1, 1),
      ]
      : [0, 0, 0, 0, 0, 0, 0];

    return [
      this.selectedMode === 0 ? 1 : 0,
      this.selectedMode === 1 ? 1 : 0,
      clamp(player.x / CONFIG.worldWidth, 0, 1),
      player.direction,
      clamp((this.speed - 1) / 4, 0, 1),
      clamp(Math.log1p(this.score) / 11, 0, 1),
      this.holeCount() / CONFIG.worldWidth,
      clamp(activeBeans.length / 12, 0, 1),
      (tongue || (player instanceof Pyoro2 && player.shootFrame > 0)) ? 1 : 0,
      this.input.action ? 1 : 0,
      player instanceof Pyoro2 ? player.shootFrame / 4 : 0,
      tongue ? clamp(tongue.x / CONFIG.worldWidth, 0, 1) : 0,
      tongue ? clamp(tongue.y / CONFIG.worldHeight, 0, 1) : 0,
      tongue?.goBack ? 1 : 0,
      ...holes,
      ...repairing,
      ...normalBeans,
      ...pinkBeans,
      ...superBeans,
      ...beanFeatures,
      ...pyoro1Features,
      ...pyoro2Features,
    ];
  }

  async init() {
    if (this.headless) {
      this.updateModeUi();
      this.enterMainMenu();
      return;
    }

    this.bindUi();
    this.applyStretchPreference();
    this.setUiPanelOpen(false);
    this.syncSoundButton();
    this.syncMusicButton();
    this.syncStretchButton();
    this.syncFullscreenButton();
    await this.loadCoreAssets();
  }

  async loadCoreAssets() {
    this.showLoadingOverlay();

    try {
      await Promise.all([
        this.assets.load(),
        this.audio.preload(),
        this.music.preload(),
        this.proceduralSfx.preload({
          bean_cut: SOUND_MANIFEST.bean_cut,
          pyoro_move: SOUND_MANIFEST.pyoro_move,
        }),
        // Canvas text does not trigger @font-face loading on its own, so the
        // game font must be ready before the menu first draws.
        document.fonts?.load
          ? document.fonts.load('26px "Pyoro UI"').catch(() => [])
          : Promise.resolve(),
      ]);
    } catch (error) {
      this.showOverlay(
        "Asset Load Failed",
        error instanceof Error ? error.message : "The browser version could not load its assets.",
        "Retry",
      );
      return;
    }

    this.assetsReady = true;
    this.updateModeUi();
    this.enterMainMenu();
    if (!this.loopStarted) {
      this.loopStarted = true;
      window.requestAnimationFrame(this.loop);
    }
  }

  showLoadingOverlay() {
    this.overlayTitle.textContent = "Loading Pyoro Web...";
    this.overlayMessage.textContent = "Preparing sprites and sounds.";
    this.overlayButton.textContent = "Loading...";
    this.overlayButton.disabled = true;
    this.overlay.classList.remove("hidden");
  }

  async primeAudio() {
    await Promise.all([
      this.audio.unlock(),
      this.music.unlock(),
      this.proceduralSfx.unlock(),
    ]);
  }

  bindUi() {
    const primeAudioOnce = () => {
      void this.primeAudio();
    };

    document.addEventListener("pointerdown", primeAudioOnce, { once: true });
    document.addEventListener("keydown", primeAudioOnce, { once: true });

    this.startButton.addEventListener("click", () => {
      void this.primeAudio();
      this.startNewRun();
    });

    this.pauseButton.addEventListener("click", () => {
      this.togglePause();
    });

    this.muteButton.addEventListener("click", () => {
      this.toggleSound();
    });

    this.musicButton.addEventListener("click", () => {
      this.toggleMusic();
    });

    this.fullscreenButton.addEventListener("click", () => {
      this.toggleFullscreen();
    });

    this.stretchButton.addEventListener("click", () => {
      this.toggleStretchFullscreen();
    });

    this.uiToggleButton.addEventListener("click", () => {
      this.toggleUiPanel();
    });

    this.uiCloseButton.addEventListener("click", () => {
      this.setUiPanelOpen(false);
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.canvasUiScreen()) {
        return;
      }

      const point = this.canvasPointFromEvent(event);
      this.menuHoverId = this.menuWidgetIdAt(point.x, point.y);
      this.canvas.style.cursor = this.menuHoverId ? "pointer" : "default";
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      if (!this.canvasUiScreen()) {
        return;
      }

      void this.primeAudio();
      const point = this.canvasPointFromEvent(event);
      this.menuPressedId = this.menuWidgetIdAt(point.x, point.y);
      this.menuHoverId = this.menuPressedId;
    });

    this.canvas.addEventListener("pointerup", (event) => {
      if (!this.canvasUiScreen()) {
        return;
      }

      const point = this.canvasPointFromEvent(event);
      const releasedId = this.menuWidgetIdAt(point.x, point.y);
      const pressedId = this.menuPressedId;
      this.menuPressedId = null;
      if (pressedId && releasedId === pressedId) {
        this.activateMenuWidget(pressedId);
      }
    });

    this.canvas.addEventListener("pointerleave", () => {
      this.menuHoverId = null;
      this.menuPressedId = null;
      if (this.canvas.style) {
        this.canvas.style.cursor = "default";
      }
    });

    this.modeClassicButton.addEventListener("click", () => {
      this.handleModeSelection(0);
    });

    this.modeAdvancedButton.addEventListener("click", () => {
      this.handleModeSelection(1);
    });

    this.overlayButton.addEventListener("click", () => {
      // The DOM overlay only exists for the loading/asset-failure states;
      // every in-game menu is drawn on the canvas.
      if (!this.assetsReady) {
        void this.loadCoreAssets();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
        event.preventDefault();
      }

      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        if (event.repeat) {
          return;
        }

        this.setDirectionInput(-1, true);
        return;
      }

      if (event.code === "ArrowRight" || event.code === "KeyD") {
        if (event.repeat) {
          return;
        }

        this.setDirectionInput(1, true);
        return;
      }

      if (event.code === "Digit1") {
        this.handleModeSelection(0);
        return;
      }

      if (event.code === "Digit2") {
        this.handleModeSelection(1);
        return;
      }

      if (event.code === "Space") {
        if (event.repeat) {
          return;
        }

        this.handleActionPress();
        return;
      }

      if (event.code === "Escape" && this.uiPanelOpen) {
        this.setUiPanelOpen(false);
        return;
      }

      if (event.code === "Escape" && this.optionsOpen) {
        this.optionsOpen = false;
        return;
      }

      if (event.code === "KeyP" || event.code === "Escape") {
        this.togglePause();
        return;
      }

      if (event.code === "KeyR") {
        this.startNewRun();
        return;
      }

      if (event.code === "KeyF") {
        this.toggleFullscreen();
        return;
      }

      if (event.code === "KeyM") {
        this.toggleUiPanel();
      }
    });

    document.addEventListener("keyup", (event) => {
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        this.setDirectionInput(-1, false);
        return;
      }

      if (event.code === "ArrowRight" || event.code === "KeyD") {
        this.setDirectionInput(1, false);
        return;
      }

      if (event.code === "Space") {
        this.handleActionRelease();
      }
    });

    for (const button of document.querySelectorAll("[data-control]")) {
      const control = button.getAttribute("data-control");

      if (control === "pause") {
        button.addEventListener("click", () => {
          this.togglePause();
        });
        continue;
      }

      const onPress = (event) => {
        event.preventDefault();

        if (control === "left") {
          this.setDirectionInput(-1, true);
        } else if (control === "right") {
          this.setDirectionInput(1, true);
        } else if (control === "action") {
          this.handleActionPress();
        }
      };

      const onRelease = (event) => {
        event.preventDefault();

        if (control === "left") {
          this.setDirectionInput(-1, false);
        } else if (control === "right") {
          this.setDirectionInput(1, false);
        } else if (control === "action") {
          this.handleActionRelease();
        }
      };

      button.addEventListener("pointerdown", onPress);
      button.addEventListener("pointerup", onRelease);
      button.addEventListener("pointerleave", onRelease);
      button.addEventListener("pointercancel", onRelease);
    }

    window.addEventListener("blur", () => {
      // The auto player keeps playing unattended; only human runs pause
      // when the browser loses focus.
      if (this.autoPlayerDriving()) {
        return;
      }

      this.input.left = false;
      this.input.right = false;
      this.input.action = false;
      if (this.started && this.running && !this.gameOver) {
        this.pause();
      }
    });

    document.addEventListener("fullscreenchange", () => {
      this.syncFullscreenButton();
    });

    document.addEventListener("webkitfullscreenchange", () => {
      this.syncFullscreenButton();
    });
  }

  toggleSound() {
    void this.primeAudio();
    this.audio.toggle();
    this.proceduralSfx.setEnabled(this.audio.enabled);
    this.save.soundEnabled = this.audio.enabled;
    writeSaveState(this.save);
    this.syncSoundButton();
  }

  toggleMusic() {
    void this.primeAudio();
    this.music.toggle();
    this.save.musicEnabled = this.music.enabled;
    writeSaveState(this.save);
    this.syncMusicButton();
    if (this.music.enabled && !this.paused) {
      this.updateMusic(0);
    }
  }

  resetSaveData() {
    const storage = browserStorage();
    try {
      storage?.removeItem(STORAGE_KEY);
      storage?.removeItem(LEGACY_HIGH_SCORE_KEY);
    } catch (_error) {
      // Storage may be unavailable; in-memory state still resets below.
    }

    this.save = defaultSaveState();
    this.highScores = this.save.highScores;
    this.selectedMode = this.save.selectedMode;
    this.audio.setEnabled(this.save.soundEnabled);
    this.proceduralSfx.setEnabled(this.save.soundEnabled);
    this.music.setEnabled(this.save.musicEnabled);
    this.autoPlayer = false;
    this.applyStretchPreference();
    this.syncSoundButton();
    this.syncMusicButton();
    this.syncStretchButton();
    this.updateModeUi();
    this.enterMainMenu();
  }

  syncSoundButton() {
    this.muteButton.textContent = this.audio.enabled ? "Sound: On" : "Sound: Off";
  }

  syncMusicButton() {
    if (!this.musicButton) {
      return;
    }

    this.musicButton.textContent = this.music.enabled ? "Music: On" : "Music: Off";
  }

  autoPlayerDriving() {
    return this.autoPlayer && this.started && !this.gameOver && !this.mainMenu;
  }

  applyDiscreteAction(actionIndex = 0) {
    const action = ACTION_DEFINITIONS[actionIndex] || ACTION_DEFINITIONS[0];
    this.setDirectionInput(-1, action.horizontal === -1, "ai");
    this.setDirectionInput(1, action.horizontal === 1, "ai");
    if (action.abilityHeld) {
      this.handleActionPress("ai");
    } else {
      this.handleActionRelease("ai");
    }
    return action;
  }

  applyStretchPreference() {
    if (!this.canvasFrame) {
      return;
    }

    this.canvasFrame.classList.toggle("stretch-fullscreen", Boolean(this.save.stretchFullscreen));
  }

  setUiPanelOpen(open) {
    // The panel is transient overlay UI: it always starts closed and is
    // never persisted, so the game can never boot covered by it.
    this.uiPanelOpen = Boolean(open);
    this.uiPanel.classList.toggle("hidden", !this.uiPanelOpen);
    this.uiToggleButton.setAttribute("aria-expanded", this.uiPanelOpen ? "true" : "false");
  }

  toggleUiPanel() {
    this.setUiPanelOpen(!this.uiPanelOpen);
  }

  syncStretchButton() {
    if (!this.stretchButton) {
      return;
    }

    if (!this.supportsFullscreen()) {
      this.stretchButton.disabled = true;
      this.stretchButton.textContent = "Stretch: Off";
      this.stretchButton.setAttribute("aria-pressed", "false");
      return;
    }

    this.stretchButton.disabled = false;
    this.stretchButton.textContent = this.save.stretchFullscreen ? "Stretch: On" : "Stretch: Off";
    this.stretchButton.setAttribute(
      "aria-pressed",
      this.save.stretchFullscreen ? "true" : "false",
    );
  }

  fullscreenElement() {
    if (typeof document === "undefined") {
      return null;
    }

    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  supportsFullscreen() {
    if (!this.canvasFrame) {
      return false;
    }

    return Boolean(this.canvasFrame.requestFullscreen || this.canvasFrame.webkitRequestFullscreen);
  }

  isFullscreenActive() {
    return this.fullscreenElement() === this.canvasFrame;
  }

  syncFullscreenButton() {
    if (!this.fullscreenButton) {
      return;
    }

    if (!this.supportsFullscreen()) {
      this.fullscreenButton.disabled = true;
      this.fullscreenButton.textContent = "Fullscreen Unsupported";
      return;
    }

    this.fullscreenButton.disabled = false;
    this.fullscreenButton.textContent = this.isFullscreenActive() ? "Exit Fullscreen" : "Fullscreen";
  }

  async enterFullscreen() {
    if (!this.canvasFrame || !this.supportsFullscreen()) {
      return;
    }

    if (this.canvasFrame.requestFullscreen) {
      await this.canvasFrame.requestFullscreen();
      return;
    }

    if (this.canvasFrame.webkitRequestFullscreen) {
      this.canvasFrame.webkitRequestFullscreen();
    }
  }

  async exitFullscreen() {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
      return;
    }

    if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  async toggleFullscreen() {
    if (!this.supportsFullscreen()) {
      return;
    }

    try {
      if (this.isFullscreenActive()) {
        await this.exitFullscreen();
      } else {
        await this.enterFullscreen();
      }
    } catch (_error) {
      return;
    }
  }

  toggleStretchFullscreen() {
    if (!this.supportsFullscreen()) {
      return;
    }

    this.save.stretchFullscreen = !this.save.stretchFullscreen;
    writeSaveState(this.save);
    this.applyStretchPreference();
    this.syncStretchButton();
  }

  canControlPlayer() {
    return Boolean(
      this.started &&
      this.running &&
      !this.paused &&
      !this.gameOver &&
      this.pyoro &&
      !this.pyoro.dead,
    );
  }

  setDirectionInput(direction, pressed, source = "human") {
    if (source === "human" && this.autoPlayerDriving()) {
      return;
    }

    if (direction === -1) {
      this.input.left = pressed;
    } else {
      this.input.right = pressed;
    }

    if (pressed) {
      this.input.lastHorizontalDirection = direction;
    }

    this.syncPlayerMovementFromInput();
  }

  syncPlayerMovementFromInput() {
    if (!this.pyoro) {
      return;
    }

    if (!this.canControlPlayer()) {
      this.pyoro.disableMove();
      return;
    }

    if (this.input.left && this.input.right) {
      this.pyoro.direction = this.input.lastHorizontalDirection;
      this.pyoro.disableMove();
      return;
    }

    if (this.input.left) {
      this.pyoro.enableMoveLeft();
      return;
    }

    if (this.input.right) {
      this.pyoro.enableMoveRight();
      return;
    }

    this.pyoro.disableMove();
  }

  handleActionPress(source = "human") {
    if (source === "human" && this.autoPlayerDriving()) {
      // The auto player owns gameplay input, but Space may still unpause.
      if (this.paused) {
        this.resume();
      }
      return;
    }

    if (this.input.action) {
      return;
    }

    this.input.action = true;
    void this.primeAudio();

    if (!this.started || this.gameOver) {
      this.startNewRun();
    } else if (this.paused) {
      this.resume();
    } else if (this.canControlPlayer()) {
      this.pyoro.shoot();
    }
  }

  handleActionRelease(source = "human") {
    if (source === "human" && this.autoPlayerDriving()) {
      this.input.action = false;
      return;
    }

    this.input.action = false;
    if (this.pyoro) {
      this.pyoro.recallAbility();
    }
  }

  currentMode() {
    return GAME_MODES[this.selectedMode] || GAME_MODES[0];
  }

  modeHighScore(modeId = this.selectedMode) {
    return this.highScores[GAME_MODES[modeId].key] || 0;
  }

  isModeUnlocked(modeId) {
    return modeId === 0 || modeId === 1;
  }

  applyModeSelection(modeId) {
    if (!this.isModeUnlocked(modeId)) {
      return false;
    }

    this.selectedMode = modeId;
    this.save.selectedMode = modeId;
    writeSaveState(this.save);
    this.updateModeUi();
    return true;
  }

  enterMainMenu() {
    this.mainMenu = true;
    this.optionsOpen = false;
    this.started = false;
    this.running = true;
    this.paused = false;
    this.gameOver = false;
    this.frameAccumulator = 0;
    this.menuHoverId = null;
    this.menuPressedId = null;
    this.resetState();
    this.updateMusic(0);
    this.hideOverlay();
    this.updateHud();
  }

  handleModeSelection(modeId) {
    if (!this.applyModeSelection(modeId)) {
      return;
    }

    if (this.started && !this.gameOver) {
      this.startNewRun(modeId);
    } else {
      this.enterMainMenu();
    }
  }

  updateModeUi() {
    this.modeClassicButton.classList.toggle("active", this.selectedMode === 0);
    this.modeAdvancedButton.classList.toggle("active", this.selectedMode === 1);
    this.modeAdvancedButton.disabled = false;
    this.modeAdvancedButton.textContent = "Pyoro 2";

    const mode = this.currentMode();

    this.modeHint.textContent = mode.id === 0
      ? (
        "Catch falling beans with your tongue. Pyoro 2 is always available from the mode selector."
      )
      : "Spit seeds diagonally to pop beans. One seed can pass through several beans for escalating combo points.";

    this.abilityTitle.textContent = `${mode.label} Ability`;
    this.abilityDescription.textContent = mode.description;
    this.abilityScoring.textContent = mode.scoring;
    this.abilityRisk.textContent = mode.risk;
  }

  resetState() {
    if (this.pyoro) {
      this.pyoro.stopMovementAudio();
    }

    this.scheduler.clear();
    this.score = 0;
    this.speed = 1;
    this.cases = Array.from({ length: CONFIG.worldWidth }, () => ({
      exists: true,
      isRepairing: false,
    }));
    this.beans = [];
    this.angels = [];
    this.popups = [];
    this.seeds = [];
    this.leaves = [];
    this.smokes = [];
    this.pyoro = this.selectedMode === 1 ? new Pyoro2(this) : new ClassicPyoro(this);
    this.currentBackgroundId = 0;
    this.backgroundFade = null;
    this.animatedBackgroundId = 13;
    this.animatedAccumulator = 0;
    this.lastMusicStyleType = 0;
    this.lastMusicScore = 0;
    this.musicPlaybackRate = 1;
    this.lastTimestamp = null;
    this.frameAccumulator = 0;
    this.input.left = false;
    this.input.right = false;
    this.input.action = false;
    this.input.lastHorizontalDirection = 1;
    this.menuBotAbilityHeld = false;
    this.menuRestartPending = false;
    this.scheduleNextBean();
  }

  startNewRun(modeId = this.selectedMode) {
    if (!this.assetsReady || !this.applyModeSelection(modeId)) {
      return;
    }

    this.mainMenu = false;
    this.optionsOpen = false;
    this.menuHoverId = null;
    this.menuPressedId = null;
    if (this.canvas.style) {
      this.canvas.style.cursor = "default";
    }
    this.started = true;
    this.running = true;
    this.paused = false;
    this.gameOver = false;
    this.frameAccumulator = 0;
    this.resetState();
    this.running = true;
    this.updateMusic(0);
    this.hideOverlay();
    this.updateHud();
  }

  pause() {
    if (!this.started || this.gameOver) {
      return;
    }

    this.running = false;
    this.paused = true;
    this.optionsOpen = false;
    this.lastTimestamp = null;
    this.frameAccumulator = 0;
    this.pyoro?.stopMovementAudio();
    this.music.pauseAll();
    this.updateHud();
  }

  resume() {
    if (!this.started || this.gameOver) {
      return;
    }

    this.running = true;
    this.paused = false;
    this.optionsOpen = false;
    this.lastTimestamp = null;
    this.frameAccumulator = 0;
    this.music.resumeAll();
    this.updateMusic(0);
    this.updateHud();
  }

  togglePause() {
    if (!this.started || this.gameOver) {
      return;
    }

    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  finishRun() {
    if (this.mainMenu) {
      // The menu's background bot died: quietly restart its level on the
      // next fixed step (never inside the scheduler callback that fired this).
      this.menuRestartPending = true;
      return;
    }

    if (this.gameOver) {
      return;
    }

    this.running = false;
    this.paused = false;
    this.gameOver = true;
    this.musicPlaybackRate = 1;
    this.audio.setPlaybackRate(1);
    this.input.left = false;
    this.input.right = false;
    this.input.action = false;
    this.syncHighScore();
    this.updateModeUi();
    this.music.stopAll();
    if (this.music.enabled) {
      this.music.playOneShot("game_over", { volume: 0.45 });
    }

    this.updateHud();
  }

  showOverlay(title, message, buttonLabel) {
    this.overlayTitle.textContent = title;
    this.overlayMessage.textContent = message;
    this.overlayButton.textContent = buttonLabel;
    this.overlayButton.disabled = false;
    this.overlay.classList.remove("hidden");
  }

  hideOverlay() {
    this.overlay.classList.add("hidden");
  }

  styleType(score = this.score) {
    if (score < 20000) {
      return 0;
    }

    if (score < 30000) {
      return 1;
    }

    return 2;
  }

  comboScore(hitCount) {
    if (hitCount <= 0) {
      return 0;
    }

    if (hitCount === 1) {
      return 50;
    }

    if (hitCount === 2) {
      return 100;
    }

    if (hitCount === 3) {
      return 300;
    }

    return 1000;
  }

  scoreForHeight(y) {
    if (y < CONFIG.worldHeight * 0.2) {
      return 1000;
    }

    if (y < CONFIG.worldHeight * 0.4) {
      return 300;
    }

    if (y < CONFIG.worldHeight * 0.6) {
      return 100;
    }

    if (y < CONFIG.worldHeight * 0.8) {
      return 50;
    }

    return 10;
  }

  addScore(value, x, y) {
    if (!value) {
      return;
    }

    this.score += value;
    this.popups.push(new ScorePopup(this, x, y, value));
    this.syncHighScore();
    this.updateHud();
  }

  syncHighScore() {
    // Bot-driven play (menu background or Auto Player) never records
    // high scores.
    if (this.mainMenu || this.autoPlayer) {
      return;
    }

    const key = this.currentMode().key;
    if (this.score > this.highScores[key]) {
      this.highScores[key] = this.score;
      this.save.highScores = this.highScores;
      writeSaveState(this.save);
    }
  }

  playSound(name, options) {
    if (name === "bean_cut") {
      const played = this.proceduralSfx.playBuffer("bean_cut", {
        gain: options?.gain ?? 5,
        playbackRate: options?.playbackRate ?? this.musicPlaybackRate,
      });
      if (played) {
        return null;
      }
    }

    return this.audio.play(name, {
      ...options,
      playbackRate: options?.playbackRate ?? this.musicPlaybackRate,
    });
  }

  playAngelChime() {
    return this.proceduralSfx.playAngelChime(1);
  }

  playPyoro2Shoot() {
    return this.proceduralSfx.playPyoro2Shoot(this.musicPlaybackRate);
  }

  backgroundKey(backgroundId) {
    return `background_${this.currentMode().backgroundSet}_${backgroundId}`;
  }

  updateAudioPlaybackRate(_deltaTime) {
    // The original fan game gradually resampled all audio faster during a
    // run, which makes the music drift audibly off pitch. The web version
    // keeps playback locked at normal speed.
    if (this.musicPlaybackRate !== 1) {
      this.musicPlaybackRate = 1;
      this.audio.setPlaybackRate(1);
      this.music.setPlaybackRate(1);
    }
  }

  updateMusic(deltaTime) {
    if (!this.music.enabled) {
      this.music.stopAll();
      return;
    }

    if (!this.started || this.gameOver) {
      this.music.stop("music_0");
      this.music.stop("music_1");
      this.music.stop("music_2");
      this.music.stop("drums");
      this.music.stop("organ");
      this.music.stop("speed_drums");
      this.music.playLoop("intro", {
        volume: 0.32,
        playbackRate: 1,
      });
      return;
    }

    this.music.stop("intro");

    const styleType = this.styleType();
    if (styleType === 0) {
      if (!this.music.isPlaying("music_0")) {
        this.music.stop("music_1");
        this.music.stop("music_2");
        this.music.stop("speed_drums");
        this.music.playLoop("music_0", {
          volume: 0.28,
          playbackRate: this.musicPlaybackRate,
        });
      }

      if (this.lastMusicScore < 5000 && this.score >= 5000 && !this.music.isPlaying("drums")) {
        this.music.playLoop("drums", {
          volume: 0.24,
          startAt: this.music.currentTime("music_0"),
          playbackRate: this.musicPlaybackRate,
        });
      }

      if (this.lastMusicScore < 10000 && this.score >= 10000 && !this.music.isPlaying("organ")) {
        this.music.playLoop("organ", {
          volume: 0.22,
          startAt: this.music.currentTime("music_0"),
          playbackRate: this.musicPlaybackRate,
        });
      }
    } else if (styleType === 1) {
      if (this.lastMusicStyleType !== styleType || !this.music.isPlaying("music_1")) {
        this.music.stopAll();
        this.music.playLoop("music_1", {
          volume: 0.32,
          playbackRate: this.musicPlaybackRate,
        });
      }
    } else {
      if (this.lastMusicStyleType !== styleType || !this.music.isPlaying("music_2")) {
        this.music.stopAll();
        this.music.playLoop("music_2", {
          volume: 0.32,
          playbackRate: this.musicPlaybackRate,
        });
      }

      if (this.lastMusicScore < 41000 && this.score >= 41000 && !this.music.isPlaying("speed_drums")) {
        this.music.playLoop("speed_drums", {
          volume: 0.22,
          startAt: this.music.currentTime("music_2"),
          playbackRate: this.musicPlaybackRate,
        });
      }
    }

    this.music.setPlaybackRate(this.musicPlaybackRate);

    this.lastMusicStyleType = styleType;
    this.lastMusicScore = this.score;
  }

  targetBackgroundId() {
    if (this.score < 11000) {
      return Math.floor(this.score / 1000);
    }

    if (this.score < 20000) {
      return 10;
    }

    if (this.score < 30000) {
      return 11;
    }

    if (this.score < 40000) {
      return 12;
    }

    return this.animatedBackgroundId;
  }

  updateAnimatedBackground(deltaTime) {
    if (this.score < 40000) {
      this.animatedBackgroundId = 13;
      this.animatedAccumulator = 0;
      return;
    }

    this.animatedAccumulator += deltaTime;
    while (this.animatedAccumulator >= CONFIG.backgroundAnimatedDuration) {
      this.animatedAccumulator -= CONFIG.backgroundAnimatedDuration;
      this.animatedBackgroundId = this.animatedBackgroundId < 20 ? this.animatedBackgroundId + 1 : 13;
    }
  }

  updateBackgroundTransition(deltaTime) {
    const target = this.targetBackgroundId();

    if (!this.backgroundFade && this.currentBackgroundId !== target) {
      this.backgroundFade = {
        fromId: this.currentBackgroundId,
        toId: target,
        progress: 0,
      };
    }

    if (!this.backgroundFade) {
      return;
    }

    if (this.backgroundFade.toId !== target) {
      this.backgroundFade = {
        fromId: this.currentBackgroundId,
        toId: target,
        progress: 0,
      };
    }

    this.backgroundFade.progress += deltaTime / CONFIG.backgroundTransitionDuration;
    if (this.backgroundFade.progress >= 1) {
      this.currentBackgroundId = this.backgroundFade.toId;
      this.backgroundFade = null;
    }
  }

  scheduleNextBean() {
    this.scheduler.schedule(
      CONFIG.beanFrequency * this.randomRange(0.5, 1.5) / (this.speed ** 1.5),
      () => {
        if (!this.gameOver) {
          this.spawnBean();
          this.scheduleNextBean();
        }
      },
    );
  }

  spawnBean() {
    const beanTypeId = Math.floor(this.randomRange(0, 6));
    const x = Math.floor(this.randomRange(0, CONFIG.worldWidth)) + 0.75;
    const speedMultiplier = this.randomRange(0.5, 1.5) * (this.speed ** 0.6);

    let type = "normal";
    if (beanTypeId >= 4 && this.score >= 5000 && beanTypeId === 5) {
      type = "super";
    } else if (beanTypeId >= 4) {
      type = "pink";
    }

    this.beans.push(new Bean(this, type, x, 0, speedMultiplier));
  }

  repairCase(preferredIndex = null) {
    const candidates = this.cases
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => !tile.exists && !tile.isRepairing);

    if (!candidates.length) {
      return;
    }

    let chosen = null;
    if (preferredIndex !== null) {
      chosen = candidates.find(({ index }) => index === preferredIndex) || null;
    }

    if (!chosen) {
      chosen = this.choice(candidates);
    }

    chosen.tile.isRepairing = true;
    this.angels.push(new Angel(this, chosen.index));
  }

  triggerSuperBean(sourceBean) {
    const otherBeans = this.beans.filter((bean) => bean !== sourceBean);
    let delay = 0;

    for (const bean of otherBeans) {
      this.scheduler.schedule(delay, () => {
        if (bean.removed || bean.caught) {
          return;
        }

        this.playSound("bean_implode");
        bean.cut({ soundName: "bean_cut" });
        bean.remove();
        this.addScore(50, bean.x, bean.y);
      });
      delay += 0.1;
    }

    const holes = this.cases
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => !tile.exists && !tile.isRepairing)
      .slice(0, 10);

    holes.forEach(({ index }, holeIndex) => {
      this.scheduler.schedule(holeIndex * 0.5, () => {
        this.repairCase(index);
      });
    });
  }

  spawnSeed(direction) {
    this.seeds.push(new Seed(this, direction));
  }

  spawnSmoke(x, y) {
    this.smokes.push(new Smoke(this, x, y));
  }

  spawnLeaf(beanType, x, y) {
    const variant = beanType === "pink" ? "pink" : beanType === "super" ? "super" : "normal";
    const speed = this.randomRange(0.5, 1.5);
    const leafX = x + this.randomRange(-0.5, 0.5);
    const leafY = y + this.randomRange(-0.5, 0.2);
    this.leaves.push(new Leaf(this, leafX, leafY, speed, variant));
  }

  driveHeuristicBot() {
    if (!this.pyoro || this.pyoro.dead) {
      return;
    }

    const decision = heuristicDecisionForGame(this);
    const action = ACTION_DEFINITIONS[decision.actionIndex] || ACTION_DEFINITIONS[0];

    if (action.horizontal === -1) {
      this.pyoro.enableMoveLeft();
    } else if (action.horizontal === 1) {
      this.pyoro.enableMoveRight();
    } else {
      this.pyoro.disableMove();
    }

    if (action.abilityHeld) {
      if (!this.menuBotAbilityHeld) {
        this.menuBotAbilityHeld = true;
        this.pyoro.shoot();
      }
    } else if (this.menuBotAbilityHeld) {
      this.menuBotAbilityHeld = false;
      this.pyoro.recallAbility();
    }
  }

  update(deltaTime) {
    if (this.mainMenu) {
      if (this.menuRestartPending) {
        this.resetState();
      }
      this.driveHeuristicBot();
    } else if (this.autoPlayerDriving()) {
      this.driveHeuristicBot();
    }

    this.speed += deltaTime * CONFIG.speedAcceleration;

    // The original Python game accelerates the whole simulation over time,
    // so entities and timers run on a scaled delta instead of raw frame time.
    const gameDelta = deltaTime * this.speed;

    this.updateAnimatedBackground(gameDelta);
    this.updateBackgroundTransition(gameDelta);
    this.pyoro.update(gameDelta);

    for (const bean of this.beans) {
      bean.update(gameDelta);
    }

    for (const angel of this.angels) {
      angel.update(gameDelta);
    }

    for (const popup of this.popups) {
      popup.update(gameDelta);
    }

    for (const seed of this.seeds) {
      seed.update(gameDelta);
    }

    for (const leaf of this.leaves) {
      leaf.update(gameDelta);
    }

    for (const smoke of this.smokes) {
      smoke.update(gameDelta);
    }

    if (this.pyoro instanceof ClassicPyoro && this.pyoro.tongue && !this.pyoro.tongue.removed) {
      this.pyoro.tongue.update(gameDelta);
    }

    this.scheduler.update(gameDelta);
    this.updateAudioPlaybackRate(deltaTime);
    this.updateMusic(deltaTime);

    this.beans = this.beans.filter((bean) => !bean.removed);
    this.angels = this.angels.filter((angel) => !angel.removed);
    this.popups = this.popups.filter((popup) => !popup.removed);
    this.seeds = this.seeds.filter((seed) => !seed.removed);
    this.leaves = this.leaves.filter((leaf) => !leaf.removed);
    this.smokes = this.smokes.filter((smoke) => !smoke.removed);

    this.updateHud();
  }

  // Android-9-patch-style stretch like the original's stretch_image: corners
  // stay crisp while edges and center stretch (frame.png is a 12x12 patch
  // with a 5px border).
  drawNinePatch(context, image, x, y, width, height, sourceBorder, destBorder) {
    const sw = image.width;
    const sh = image.height;
    const sb = Math.min(sourceBorder, Math.floor(sw / 2), Math.floor(sh / 2));
    const db = Math.min(destBorder, Math.floor(width / 2), Math.floor(height / 2));

    // corners
    context.drawImage(image, 0, 0, sb, sb, x, y, db, db);
    context.drawImage(image, sw - sb, 0, sb, sb, x + width - db, y, db, db);
    context.drawImage(image, 0, sh - sb, sb, sb, x, y + height - db, db, db);
    context.drawImage(image, sw - sb, sh - sb, sb, sb, x + width - db, y + height - db, db, db);
    // edges
    context.drawImage(image, sb, 0, sw - sb * 2, sb, x + db, y, width - db * 2, db);
    context.drawImage(image, sb, sh - sb, sw - sb * 2, sb, x + db, y + height - db, width - db * 2, db);
    context.drawImage(image, 0, sb, sb, sh - sb * 2, x, y + db, db, height - db * 2);
    context.drawImage(image, sw - sb, sb, sb, sh - sb * 2, x + width - db, y + db, db, height - db * 2);
    // center
    context.drawImage(
      image,
      sb, sb, sw - sb * 2, sh - sb * 2,
      x + db, y + db, width - db * 2, height - db * 2,
    );
  }

  drawCenteredImage(context, image, x, y, width, height) {
    context.drawImage(
      image,
      (x - width / 2) * CONFIG.unit,
      (y - height / 2) * CONFIG.unit,
      width * CONFIG.unit,
      height * CONFIG.unit,
    );
  }

  drawBackground(context) {
    const drawLayer = (backgroundId, alpha = 1) => {
      const image = this.assets.get(this.backgroundKey(backgroundId));
      if (!image) {
        return;
      }

      context.save();
      context.globalAlpha = alpha;
      context.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      context.restore();
    };

    if (this.backgroundFade) {
      drawLayer(this.backgroundFade.fromId, 1);
      drawLayer(this.backgroundFade.toId, clamp(this.backgroundFade.progress, 0, 1));
      return;
    }

    drawLayer(this.currentBackgroundId, 1);
  }

  drawBlocks(context) {
    const block = this.assets.get(`block_${this.styleType()}`);
    if (!block) {
      return;
    }

    const y = this.canvas.height - CONFIG.unit;
    for (let index = 0; index < this.cases.length; index += 1) {
      if (!this.cases[index].exists) {
        continue;
      }

      context.drawImage(block, index * CONFIG.unit, y, CONFIG.unit, CONFIG.unit);
    }
  }

  drawTongueBody(context) {
    const tongue = this.pyoro instanceof ClassicPyoro ? this.pyoro.tongue : null;
    if (!tongue || tongue.removed) {
      return;
    }

    const style = this.styleType();
    let insideColor = "#ff62b7";
    let outlineColor = "#000000";

    if (style === 1) {
      insideColor = "#b2b2b2";
    } else if (style === 2) {
      insideColor = "#000000";
      outlineColor = "#ffffff";
    }

    const tx1 = tongue.x - tongue.width * 0.5 * this.pyoro.direction;
    const tx2 = tongue.x - tongue.width * 0.4 * this.pyoro.direction;
    const px1 = this.pyoro.x + this.pyoro.width * 0.25 * this.pyoro.direction;
    const px2 = this.pyoro.x + this.pyoro.width * 0.3125 * this.pyoro.direction;

    const ty1 = tongue.y + tongue.height * 0.4;
    const ty2 = tongue.y + tongue.height * 0.5;
    const py1 = this.pyoro.y - this.pyoro.height * 0.125;
    const py2 = this.pyoro.y - this.pyoro.height * 0.0625;

    const points = [
      [px1, py1],
      [tx1, ty1],
      [tx2, ty2],
      [px2, py2],
    ].map(([x, y]) => [x * CONFIG.unit + 5, y * CONFIG.unit + 5]);

    context.save();
    context.fillStyle = insideColor;
    context.strokeStyle = outlineColor;
    context.lineJoin = "round";
    context.lineCap = "round";

    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index][0], points[index][1]);
    }
    context.closePath();
    context.fill();

    context.lineWidth = Math.max(2, Math.round(CONFIG.unit * 0.12));
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    context.lineTo(points[1][0], points[1][1]);
    context.stroke();

    context.beginPath();
    context.moveTo(points[2][0], points[2][1]);
    context.lineTo(points[3][0], points[3][1]);
    context.stroke();
    context.restore();
  }

  // The options screen mirrors the original OptionMenu dialog: a stretched
  // frame background, left-aligned labels, and game-sprite buttons on the
  // right, adapted to web-relevant settings.
  canvasUiScreen() {
    if (this.mainMenu) {
      return this.optionsOpen ? "options" : "main";
    }
    if (this.paused) {
      return this.optionsOpen ? "options" : "pause";
    }
    if (this.gameOver) {
      return "gameover";
    }
    return null;
  }

  optionsRows() {
    const rows = [
      { id: "optMusic", label: "Music", value: this.music.enabled ? "On" : "Off" },
      { id: "optSound", label: "Sound Effects", value: this.audio.enabled ? "On" : "Off" },
    ];

    if (this.supportsFullscreen()) {
      rows.push(
        { id: "optStretch", label: "Stretch In Fullscreen", value: this.save.stretchFullscreen ? "On" : "Off" },
        { id: "optFullscreen", label: "Fullscreen", value: this.isFullscreenActive() ? "On" : "Off" },
      );
    }

    return rows;
  }

  menuWidgets() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const screen = this.canvasUiScreen();

    if (screen === "pause") {
      // Mirrors the original PauseMenu: title plus three clickable texts.
      return [
        { id: "pauseResume", type: "text", label: "Continue", rect: [0.38 * w, 0.42 * h, 0.24 * w, 0.07 * h], fontScale: 0.034 },
        { id: "pauseOptions", type: "text", label: "Options", rect: [0.38 * w, 0.53 * h, 0.24 * w, 0.07 * h], fontScale: 0.034 },
        { id: "pauseQuit", type: "text", label: "Quit", rect: [0.38 * w, 0.64 * h, 0.24 * w, 0.07 * h], fontScale: 0.034 },
      ];
    }

    if (screen === "gameover") {
      // Mirrors the original GameOverMenu: title, score, one clickable text.
      return [
        { id: "gameOverMenu", type: "text", label: "Menu", rect: [0.38 * w, 0.60 * h, 0.24 * w, 0.07 * h], fontScale: 0.034 },
      ];
    }

    if (screen === "options") {
      const widgets = this.optionsRows().map((row, index) => ({
        id: row.id,
        image: "menu_button",
        rect: [0.7 * w, (0.2 + index * 0.12 - 0.04) * h, 0.2 * w, 0.08 * h],
        label: row.value,
        fontScale: 0.03,
        labelAnchorY: 0,
      }));

      widgets.push(
        {
          id: "optReset",
          image: "menu_button",
          rect: [0.05 * w, 0.88 * h, 0.4 * w, 0.07 * h],
          label: "Reset Save Data",
          fontScale: 0.03,
          labelAnchorY: 0,
        },
        {
          id: "optBack",
          image: "menu_button",
          rect: [0.55 * w, 0.88 * h, 0.4 * w, 0.07 * h],
          label: "Back",
          fontScale: 0.03,
          labelAnchorY: 0,
        },
      );

      return widgets;
    }

    // Main menu rects mirror the original's "Wide" layout template
    // (src/data/layouts.json): play tiles right of center, option and quit
    // buttons below them. The web swaps "Quitter" for a fullscreen toggle.
    // The play tiles stay square like their 95x95 source sprites.
    const tileSide = 0.2 * w;
    const switchHeight = 0.075 * h;
    const switchWidth = switchHeight * (120 / 72);

    const widgets = [
      {
        id: "play1",
        image: "play_button_1",
        rect: [0.7 * w - tileSide, 0.5 * h - tileSide, tileSide, tileSide],
        label: `High Score: ${formatScore(this.highScores.pyoro1)}`,
        fontScale: 0.028,
        labelAnchorY: -0.1,
      },
      {
        id: "play2",
        image: "play_button_2",
        rect: [0.75 * w, 0.5 * h - tileSide, tileSide, tileSide],
        label: `High Score: ${formatScore(this.highScores.pyoro2)}`,
        fontScale: 0.028,
        labelAnchorY: -0.1,
      },
      {
        id: "options",
        image: "menu_button",
        rect: [0.5 * w, 0.6 * h, 0.2 * w, 0.1 * h],
        label: "Options",
        fontScale: 0.036,
        labelAnchorY: 0,
      },
      {
        id: "fullscreen",
        image: "menu_button",
        rect: [0.75 * w, 0.6 * h, 0.2 * w, 0.1 * h],
        label: this.isFullscreenActive() ? "Exit Fullscreen" : "Fullscreen",
        fontScale: 0.036,
        labelAnchorY: 0,
      },
      {
        id: "autoPlayer",
        image: this.autoPlayer ? "switch_on" : "switch_off",
        rect: [0.725 * w - switchWidth / 2, 0.78 * h - switchHeight / 2, switchWidth, switchHeight],
        label: null,
        fontScale: 0.03,
        labelAnchorY: 0,
      },
    ];

    return widgets;
  }

  menuWidgetIdAt(x, y) {
    for (const widget of this.menuWidgets()) {
      const [left, top, width, height] = widget.rect;
      if (x >= left && x <= left + width && y >= top && y <= top + height) {
        return widget.id;
      }
    }
    return null;
  }

  activateMenuWidget(widgetId) {
    if (widgetId === "play1") {
      this.startNewRun(0);
    } else if (widgetId === "play2") {
      this.startNewRun(1);
    } else if (widgetId === "options" || widgetId === "pauseOptions") {
      this.optionsOpen = true;
    } else if (widgetId === "fullscreen" || widgetId === "optFullscreen") {
      void this.toggleFullscreen();
    } else if (widgetId === "optMusic") {
      this.toggleMusic();
    } else if (widgetId === "optSound") {
      this.toggleSound();
    } else if (widgetId === "autoPlayer") {
      this.autoPlayer = !this.autoPlayer;
    } else if (widgetId === "optStretch") {
      this.toggleStretchFullscreen();
    } else if (widgetId === "optReset") {
      this.resetSaveData();
    } else if (widgetId === "optBack") {
      this.optionsOpen = false;
    } else if (widgetId === "pauseResume") {
      this.resume();
    } else if (widgetId === "pauseQuit" || widgetId === "gameOverMenu") {
      this.enterMainMenu();
    }
  }

  canvasPointFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: -1, y: -1 };
    }

    return {
      x: (event.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (event.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  drawMenuText(context, text, x, y, fontSize, align = "center", fillStyle = "#ffffff") {
    context.save();
    context.font = `${fontSize}px "Pyoro UI", monospace`;
    context.textAlign = align;
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = Math.max(3, Math.round(fontSize * 0.18));
    context.strokeStyle = "rgba(0, 0, 0, 0.7)";
    context.fillStyle = fillStyle;
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
    context.restore();
  }

  drawDialogFrame(context, x, y, width, height) {
    const frame = this.assets.get("menu_frame");
    if (frame) {
      this.drawNinePatch(context, frame, x, y, width, height, 5, 10);
      return;
    }

    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.55)";
    context.fillRect(x, y, width, height);
    context.restore();
  }

  drawMenu(context) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const screen = this.canvasUiScreen();

    if (screen === "pause") {
      this.drawDialogFrame(context, 0.34 * w, 0.24 * h, 0.32 * w, 0.52 * h);
      this.drawMenuText(context, "Pause", 0.5 * w, 0.33 * h, Math.round(h * 0.045));
    } else if (screen === "gameover") {
      this.drawDialogFrame(context, 0.34 * w, 0.26 * h, 0.32 * w, 0.48 * h);
      this.drawMenuText(context, "Game Over", 0.5 * w, 0.35 * h, Math.round(h * 0.045));
      this.drawMenuText(
        context,
        `Score: ${formatScore(this.score)}`,
        0.5 * w,
        0.48 * h,
        Math.round(h * 0.032),
      );
      this.drawMenuText(
        context,
        "Space or R for a rematch",
        0.5 * w,
        0.7 * h,
        Math.round(h * 0.02),
        "center",
        "#d9d6f0",
      );
    } else if (screen === "options") {
      this.drawDialogFrame(context, 0, 0, w, h);
      this.drawMenuText(context, "Options", 0.5 * w, 0.09 * h, Math.round(h * 0.05));
      for (const [index, row] of this.optionsRows().entries()) {
        this.drawMenuText(
          context,
          row.label,
          0.08 * w,
          (0.2 + index * 0.12) * h,
          Math.round(h * 0.032),
          "left",
        );
      }
      this.drawMenuText(context, "Pyoro Web", 0.95 * w, 0.8 * h, Math.round(h * 0.022), "right");
    } else {
      const title = this.assets.get("menu_title");
      if (title) {
        const titleWidth = 0.47 * w;
        const titleHeight = 0.2 * h;
        context.drawImage(
          title,
          0.25 * w - titleWidth / 2,
          0.5 * h - titleHeight / 2,
          titleWidth,
          titleHeight,
        );
      }

      this.drawMenuText(
        context,
        "Auto Player",
        0.5 * w,
        0.78 * h,
        Math.round(h * 0.032),
        "left",
      );
    }

    for (const widget of this.menuWidgets()) {
      const [left, top, width, height] = widget.rect;
      const hovered = this.menuHoverId === widget.id;
      const pressed = hovered && this.menuPressedId === widget.id;

      if (widget.type === "text") {
        // Clickable text like the original's ClickableText widgets:
        // highlighted while hovered, dimmed while pressed.
        const color = pressed ? "#d2a92a" : hovered ? "#ffd54a" : "#ffffff";
        this.drawMenuText(
          context,
          widget.label,
          left + width / 2,
          top + height / 2,
          Math.round(h * widget.fontScale),
          "center",
          color,
        );
        continue;
      }

      const variant = pressed ? "_click" : hovered ? "_hover" : "";
      const image = this.assets.get(`${widget.image}${variant}`)
        || this.assets.get(widget.image);

      if (image) {
        context.drawImage(image, left, top, width, height);
      }

      if (widget.label) {
        this.drawMenuText(
          context,
          widget.label,
          left + width / 2,
          top + height / 2 + widget.labelAnchorY * height,
          Math.round(h * widget.fontScale),
        );
      }
    }
  }

  drawCanvasHud(context) {
    // Match the original's minimal presentation: plain outlined text at the
    // layout template's positions (score centered at 25% width, high score
    // at 75%, near the top edge).
    const scoreText = `Score: ${formatScore(this.score)}`;
    const highScoreText = `High Score: ${formatScore(this.modeHighScore())}`;
    const y = Math.round(this.canvas.height * 0.05);

    context.save();
    context.font = '26px "Pyoro UI", monospace';
    context.textAlign = "center";
    context.textBaseline = "top";
    context.lineJoin = "round";
    context.lineWidth = 5;
    context.strokeStyle = "rgba(0, 0, 0, 0.7)";
    context.fillStyle = "#ffffff";
    context.strokeText(scoreText, this.canvas.width * 0.25, y);
    context.fillText(scoreText, this.canvas.width * 0.25, y);
    context.strokeText(highScoreText, this.canvas.width * 0.75, y);
    context.fillText(highScoreText, this.canvas.width * 0.75, y);
    context.restore();
  }

  render() {
    if (!this.context) {
      return;
    }

    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground(this.context);
    this.drawBlocks(this.context);
    this.drawTongueBody(this.context);

    for (const leaf of this.leaves) {
      leaf.draw(this.context);
    }

    for (const bean of this.beans) {
      bean.draw(this.context);
    }

    this.pyoro.draw(this.context);

    if (this.pyoro instanceof ClassicPyoro && this.pyoro.tongue && !this.pyoro.tongue.removed) {
      this.pyoro.tongue.draw(this.context);
    }

    for (const angel of this.angels) {
      angel.draw(this.context);
    }

    for (const smoke of this.smokes) {
      smoke.draw(this.context);
    }

    for (const seed of this.seeds) {
      seed.draw(this.context);
    }

    for (const popup of this.popups) {
      popup.draw(this.context);
    }

    if (this.started && !this.mainMenu) {
      this.drawCanvasHud(this.context);
    }

    if (this.canvasUiScreen()) {
      this.drawMenu(this.context);
    }
  }

  updateHud() {
    this.scoreValue.textContent = formatScore(this.score);
    this.highScoreValue.textContent = formatScore(this.modeHighScore());
    this.modeValue.textContent = this.currentMode().label;
    this.holesValue.textContent = String(this.cases.filter((tile) => !tile.exists).length);
    this.speedValue.textContent = `${this.speed.toFixed(2)}x`;

    if (this.mainMenu) {
      this.statusValue.textContent = "Menu";
    } else if (!this.started) {
      this.statusValue.textContent = "Ready";
    } else if (this.gameOver) {
      this.statusValue.textContent = "Game Over";
    } else if (this.paused) {
      this.statusValue.textContent = "Paused";
    } else if (this.running) {
      this.statusValue.textContent = "Running";
    } else {
      this.statusValue.textContent = "Waiting";
    }

    this.pauseButton.disabled = !this.started || this.gameOver;
    this.pauseButton.textContent = this.paused ? "Resume" : "Pause";
  }

  runFixedStep(actionIndex = null, deltaTime = this.fixedStep) {
    if (actionIndex !== null) {
      this.applyDiscreteAction(actionIndex);
    }

    if (this.running) {
      this.update(deltaTime);
    }

    // Observations only matter to the headless training environment; the
    // browser loop discards them, so skip that work in the browser.
    return this.headless ? this.buildPolicyObservation() : null;
  }

  loop(timestamp) {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
    }

    const deltaTime = Math.min((timestamp - this.lastTimestamp) / 1000, CONFIG.maxFrameDelta);
    this.lastTimestamp = timestamp;

    if (this.running) {
      this.frameAccumulator += deltaTime;
      let subSteps = 0;
      while (this.frameAccumulator >= this.fixedStep && subSteps < this.maxSubSteps) {
        this.runFixedStep(null, this.fixedStep);
        this.frameAccumulator -= this.fixedStep;
        subSteps += 1;
      }

      if (subSteps >= this.maxSubSteps) {
        this.frameAccumulator = 0;
      }
    } else {
      this.frameAccumulator = 0;
    }

    this.render();
    if (!this.headless) {
      window.requestAnimationFrame(this.loop);
    }
  }
}

const shouldAutoBoot = typeof document !== "undefined" && Boolean(document.getElementById("gameCanvas"));

if (shouldAutoBoot) {
  const game = new PyoroWebGame();
  void game.init();
}

export {
  CONFIG,
  GAME_MODES,
  PyoroWebGame,
};
