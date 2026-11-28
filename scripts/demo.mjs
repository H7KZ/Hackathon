#!/usr/bin/env node
/**
 * `pnpm demo`: the real stack (API :4000 + UI :3000) replaying the committed LLM cache, no network.
 * Every LLM step is pinned to the model the demo was recorded with, so per-step model overrides in a
 * local env file cannot change the cache keys. Recorded prompts: the three landing examples
 * ("Dodavatel", "Marketing", "Podpora") with the suggested what-if questions and the detective
 * (docs/runs/2026-11-28-live-e2e-3.md). Anything else needs a live model: `pnpm dev`.
 */
import { spawn } from "node:child_process";

const say = (line) => process.stdout.write(line + "\n");
const model = process.env.LIVE_MODEL ?? "anthropic:claude-sonnet-5-5";
const steps = [
  "01_COMPANY",
  "02_MODEL",
  "03_INFLUENCES",
  "03A_CAUSAL_MAP",
  "03B_PROCESSES",
  "04A_OVERLAY",
  "04B_EXPECTATIONS",
  "04_STORY",
  "05_SCENARIO",
  "WHAT_IF",
  "DETECTIVE_STEP",
  "DETECTIVE_REPORT",
];
const env = {
  ...process.env,
  LLM_OFFLINE: process.env.LLM_OFFLINE ?? "1",
  LLM_MODEL: model,
  CASCADE_DESIGN: process.env.CASCADE_DESIGN ?? "v1",
  API_FAKE: "",
  ...Object.fromEntries(steps.map((s) => [`LLM_MODEL_${s}`, model])),
};
say(`demo: LLM_OFFLINE=${env.LLM_OFFLINE}, every step on ${model}, design ${env.CASCADE_DESIGN}`);
const child = spawn("pnpm", ["dev"], { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
