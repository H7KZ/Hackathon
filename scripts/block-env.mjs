#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash): block commands that mention an env file.
// Catches accidental reads (cat, grep, node -e, …); it is not a security boundary.
// `.env.example` and `process.env` are allowed. Fail-open on bad input.
import { readFileSync } from "node:fs";

let command = "";
try {
  command = JSON.parse(readFileSync(0, "utf8") || "{}").tool_input?.command ?? "";
} catch {
  process.exit(0);
}

if (/(?<![\w$])\.env\b(?!\.example)/.test(command)) {
  console.error(
    "Blocked: agents must not touch env files (AGENTS.md, Agent autonomy). Ask the user to run this.",
  );
  process.exit(2);
}
process.exit(0);
