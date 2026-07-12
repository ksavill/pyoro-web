# Pyoro Web

![Main menu](https://github.com/RedbeanGit/Pyoro/blob/main/Pyoro.png?raw=true)

Pyoro Web is a browser-native port of [RedbeanGit/Pyoro](https://github.com/RedbeanGit/Pyoro), a Python/Pygame fan game recreation of Pyoro. The runtime is plain `HTML`, `CSS`, and `JavaScript`, so the game can be hosted as static files and played directly in a browser.

The original Python source is not included in this repo; the gameplay logic was ported to JavaScript using it as the reference. The sprites, audio, and font under `Pyoro/src/data` come from that original project.

## Quick Start

From the repo root:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:4173/
```

There is no build step and no runtime dependencies to install for local development.

If you prefer, the same scripts also work from inside `Pyoro`.

## Available Scripts

```bash
npm run dev
```

Starts the built-in static dev server.

```bash
npm run start
```

Same as `npm run dev`.

```bash
npm run check
```

Runs syntax checks on the browser app and dev server scripts.

```bash
npm run train:agent -- --mode pyoro2
```

Trains a simple policy-gradient agent offline against the browser game's headless environment and writes a model to `web/models`.

Supported modes:

- `--mode pyoro1` for regular Pyoro
- `--mode pyoro2` for Pyoro 2
- Omitting `--mode` defaults to `pyoro1`

Default training configuration:

- `160` iterations
- `24` training episodes per iteration
- `12` evaluation episodes per iteration
- `3600` max steps per episode
- `480` max no-score steps before an episode is ended early
- `3840` training episodes total
- `1920` evaluation episodes total
- `5760` total episode rollouts per full default run

Training notes:

- Training now uses a small actor-critic MLP instead of the earlier linear policy
- Validation uses a fixed seed set each iteration so model selection is less noisy
- Episodes end early if the agent goes too long without scoring, which discourages stall-for-lifetime strategies
- Reward shaping includes both score and floor health, so badly damaged boards are penalized over time even if the agent stays alive
- Evaluation now reports floor-health metrics alongside score so model selection can prefer healthier board states when scores are similar

```bash
npm run evaluate:agent -- --mode pyoro2
```

Evaluates a trained agent model against the same headless environment.

```bash
npm run evaluate:heuristic
```

Evaluates the heuristic used by the browser's Auto Player over deterministic
seeded games. The default run disables the no-score timeout, allows up to
`120000` simulation steps per game, and reports score distribution plus the
rate of games that clear `5000`. To customize it from the repository root,
invoke the script directly, for example:

```bash
node Pyoro/scripts/evaluate-heuristic.mjs --mode pyoro1 --episodes 5 --max-steps 30000
```

It also accepts `--target-score`, `--seed`, and `--max-no-score-steps`.

## Browser Game Features

- Browser-native standalone implementation using `canvas`
- Original-style main menu with play tiles for both modes, drawn with the original sprites and font over a live bot-played level
- Original Pyoro mode with tongue catching, pink/super bean behavior, and floor repair flow
- Pyoro 2 mode with browser-native shooting behavior available from the menu immediately
- Keyboard and touch controls, original-inspired music playback, and browser fullscreen toggle support with optional stretch-to-fill
- Auto Player switch on the main menu that lets the built-in heuristic bot play full runs (bot runs never record high scores)
- Static hosting friendly: no Python runtime required
- Reuses the original project's assets from `src/data/images` and `src/data/audio`

## Project Structure

- `index.html`: main browser entrypoint
- `web/app.js`: browser game runtime
- `web/agent-policy.js`: shared action definitions and policy utilities for the offline scripts
- `web/headless-env.js`: headless environment wrapper for training and evaluation
- `web/models`: generated AI policy files (offline training artifacts)
- `web/styles.css`: browser UI styling
- `scripts/dev-server.mjs`: zero-dependency local static server
- `scripts/check.mjs`: syntax checks for the web-first project
- `scripts/train-agent.mjs`: offline policy-gradient training script
- `scripts/evaluate-agent.mjs`: offline evaluation script
- `scripts/evaluate-heuristic.mjs`: seeded Auto Player evaluation script
- `src/data`: game assets (sprites, audio, font) from the original Pyoro project

## AI Agents

The browser game uses a built-in heuristic bot for the main menu's background level and for the Auto Player switch — no model download is needed to play or spectate.

The offline training and evaluation scripts remain available and write trained policy models to:

- `web/models/pyoro1-agent.json`
- `web/models/pyoro2-agent.json`

There is support for both game variants:

- `pyoro1` for regular Pyoro
- `pyoro2` for Pyoro 2

The training scripts and the browser share the same JavaScript gameplay logic. Training runs headlessly in Node with a fixed simulation step, seeded RNG, and early no-score termination. The trained models are offline artifacts; the browser runtime no longer loads them.

## Deploy

Because the web version is static HTML/CSS/JavaScript, you can deploy the `Pyoro` directory directly to:

- GitHub Pages
- Netlify
- Vercel static hosting
- Amazon S3/static hosting
- Any ordinary web server that serves static files

No Python runtime is needed after deployment.

## Credits

This project is a port of [Pyoro by RedbeanGit](https://github.com/RedbeanGit/Pyoro) (GPL-3.0), a Python/Pygame fan game recreation of Nintendo's Pyoro. The sprites, sounds, music, and font in `Pyoro/src/data` originate from that project, and its gameplay code served as the reference for this port. Pyoro itself is a Nintendo game; this is an unofficial fan project.
