#!/usr/bin/env bash
# Cursor stop hook: ask the agent to run unit tests and review the uncommitted diff once.
set -euo pipefail
input=$(cat)
printf '%s' "$input" | node --input-type=module -e '
import { stdin } from "node:process";

let raw = "";
stdin.setEncoding("utf8");
stdin.on("data", (c) => { raw += c; });
stdin.on("end", () => {
  let data = {};
  try { data = raw.trim() ? JSON.parse(raw) : {}; } catch { data = {}; }
  const loopCount = Number(data.loop_count ?? data.loopCount ?? 0);
  if (loopCount >= 1) {
    process.stdout.write("{}\n");
    return;
  }
  const followup_message = [
    "You just finished a coding turn. Before stopping:",
    "1. Run `pnpm --filter my-llm-server test:unit`. If tests fail, fix them.",
    "2. Review the uncommitted git diff (do not edit plan files) for auth leaks, handoff false positives, and missing tests.",
    "3. Fix real issues. If none, reply in 2-3 sentences: tests pass / no review findings.",
    "Run this follow-up at most once.",
  ].join("\n");
  process.stdout.write(JSON.stringify({ followup_message }) + "\n");
});
'
