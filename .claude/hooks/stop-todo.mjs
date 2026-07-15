#!/usr/bin/env node

import process from "node:process";

let input;
try {
  input = JSON.parse(await readStdin());
} catch {
  process.stderr.write("Stop TODO hook received malformed input.\n");
  process.exitCode = 1;
}

if (input && input.stop_hook_active !== true) {
  const message = input.last_assistant_message;
  if (typeof message === "string" && hasUnresolvedMarker(message)) {
    writeJson({
      decision: "block",
      reason:
        "The proposed final response still contains an unchecked task, TODO, or FIXME marker. Complete it now, or replace the marker with an explicit unresolved-risk report before stopping.",
    });
  }
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function hasUnresolvedMarker(message) {
  return message
    .split(/\r?\n/u)
    .some((line) => /^\s*(?:[-*]\s+\[ \]|(?:TODO|FIXME)\b)/iu.test(line));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
