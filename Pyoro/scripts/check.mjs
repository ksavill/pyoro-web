import { spawnSync } from "node:child_process";

const filesToCheck = [
  "web/app.js",
  "web/agent-policy.js",
  "web/heuristic-policy.js",
  "web/headless-env.js",
  "scripts/dev-server.mjs",
  "scripts/train-agent.mjs",
  "scripts/evaluate-agent.mjs",
  "scripts/evaluate-heuristic.mjs",
];

for (const filePath of filesToCheck) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Syntax checks passed.");
