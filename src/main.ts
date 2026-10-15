#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { runChat } from "./hosts/chat/index.js";
import { runMcp } from "./hosts/mcp.js";
import type { GroupNode } from "./manifest/define.js";

const USAGE = `Usage: a-jit <mcp|chat> <manifest-file>

  mcp    Serve the A-JIT tools over MCP on stdio, for an MCP host to launch.
  chat   Chat in the terminal with an OpenAI-compatible model (AJIT_BASE_URL, AJIT_API_KEY, AJIT_MODEL).

The manifest file must default-export a manifest().`;

const modes = { mcp: runMcp, chat: runChat };

/** Imports the user's manifest file and returns its default export. */
const loadManifest = async (file: string): Promise<GroupNode> => {
  const module = await import(pathToFileURL(resolve(file)).href);
  const manifest = module.default;
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`${file} must default-export a manifest, e.g. "export default manifest({ ... })".`);
  }
  return manifest;
};

const [mode, file] = process.argv.slice(2);
if (!file || !(mode === "mcp" || mode === "chat")) {
  // stderr, so a misconfigured MCP host never sees this on the protocol channel.
  console.error(USAGE);
  process.exit(1);
}

await modes[mode](await loadManifest(file), loadConfig());
