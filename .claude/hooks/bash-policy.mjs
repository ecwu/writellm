#!/usr/bin/env node

import process from "node:process";

const guardedPatterns = [
  /(^|[;&|]\s*)sudo\b/u,
  /\brm\s+(?:[^\n;&|]*\s)?-[^\n;&|]*[rf][^\n;&|]*\b/u,
  /\bgit\s+(?:-[^\s]+\s+)*(?:commit|push|reset\s+--hard|clean\s+-|checkout\s+--|restore\b)/u,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|update|upgrade)\b/u,
  /\bchmod\s+(?:-[^\s]*R[^\s]*\s|--recursive\b)/u,
  /\b(?:kill|killall|pkill)\b/u,
  /\b(?:curl|wget)\b[^\n]*(?:\||>)\s*(?:sh|bash|zsh|fish)\b/u,
];

let input;
try {
  input = JSON.parse(await readStdin());
} catch {
  process.stderr.write("Bash policy hook received malformed input.\n");
  process.exitCode = 1;
}

if (input) {
  const command = input.tool_input?.command;
  if (typeof command === "string" && guardedPatterns.some((pattern) => pattern.test(command))) {
    writeJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "This command can mutate dependencies, repository history, permissions, processes, or external state. Confirm it explicitly before execution.",
      },
    });
  }
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
