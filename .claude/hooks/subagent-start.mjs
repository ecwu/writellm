#!/usr/bin/env node

import process from "node:process";

let input;
try {
  input = JSON.parse(await readStdin());
} catch {
  process.stderr.write("Subagent context hook received malformed input.\n");
  process.exitCode = 1;
}

if (input) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext:
        "Follow AGENTS.md and stay within the assigned capability. Do not delegate, expand the current checkpoint, commit, push, or perform unrelated cleanup. Return exactly the four required handoff sections.",
    },
  });
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
