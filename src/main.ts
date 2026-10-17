#!/usr/bin/env node
import { resolve } from "node:path";
import { loadCatalog } from "./capabilities/catalog.js";
import { loadConfig } from "./config.js";
import { runChat } from "./hosts/chat/index.js";
import { guardStdout, runMcp } from "./hosts/mcp.js";

const USAGE = `Usage: a-jit <mcp|chat> <bindings-dir>

  mcp    Serve the A-JIT tools over MCP on stdio, for an MCP host to launch.
  chat   Chat in the terminal with an OpenAI-compatible model (AJIT_BASE_URL, AJIT_API_KEY, AJIT_MODEL).

Each file in the bindings directory default-exports one capability, named by
the file: weather.hourly.ts provides "weather.hourly". Files starting with "_"
or ".", tests and subdirectories are skipped.`;

const modes = { mcp: runMcp, chat: runChat };

const [mode, dir] = process.argv.slice(2);
if (!dir || !(mode === "mcp" || mode === "chat")) {
  // stderr, so a misconfigured MCP host never sees this on the protocol channel.
  console.error(USAGE);
  process.exit(1);
}

if (mode === "mcp") {
  guardStdout();
}

const { capabilities, errors } = await loadCatalog(resolve(dir));
for (const { file, message } of errors) {
  console.error(`Skipped ${file}: ${message}`);
}
if (capabilities.size === 0) {
  console.error(`No capabilities found in ${resolve(dir)}.`);
}

await modes[mode](capabilities, loadConfig());
