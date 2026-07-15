#!/usr/bin/env node

import process from "node:process";

const requiredHeadings = [
  "## Summary",
  "## Evidence / files",
  "## Verification",
  "## Unresolved risks",
];

let input;
try {
  input = JSON.parse(await readStdin());
} catch {
  process.stderr.write("Subagent output hook received malformed input.\n");
  process.exitCode = 1;
}

if (input && input.stop_hook_active !== true) {
  const message = input.last_assistant_message;
  if (typeof message === "string" && message.trim()) {
    const missing = requiredHeadings.filter((heading) => !hasHeading(message, heading));
    if (missing.length > 0) {
      writeJson({
        decision: "block",
        reason:
          "Before stopping, return exactly these sections: Summary, Evidence / files, Verification, and Unresolved risks. Include every section even when its value is none.",
      });
    }
  }
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function hasHeading(message, heading) {
  return message.split(/\r?\n/u).some((line) => line.trim() === heading);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
