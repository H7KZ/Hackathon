#!/usr/bin/env node
// Claude Code Stop hook: an agent may not finish a turn with red `pnpm verify:fast`.
// Exit 2 = block the stop and feed stderr back to the agent.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  /* no stdin */
}

// Nothing code-related changed -> nothing to verify.
const changed = execSync("git status --porcelain -uall", { encoding: "utf8" })
  .split("\n")
  .filter((l) => /\.(ts|tsx|js|mjs|cjs|json)$/.test(l.trim()));
if (changed.length === 0) process.exit(0);

try {
  execSync("pnpm verify:fast", { stdio: "pipe", encoding: "utf8", timeout: 280_000 });
  process.exit(0);
} catch (err) {
  const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.slice(-6000);
  if (input.stop_hook_active) {
    // Second failure in a row: let the agent stop, but make the failure visible.
    console.error(`verify:fast still failing — report this to the user:\n${out}`);
    process.exit(0);
  }
  console.error(`pnpm verify:fast failed. Fix before finishing (AGENTS.md "Definition of done"):\n${out}`);
  process.exit(2);
}
