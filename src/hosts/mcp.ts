import { Console } from "node:console";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildMcpInstructions } from "../agent/prompt.js";
import { executeTool } from "../agent/tool.js";
import { componentTools, hostTools } from "../agent/tools.js";
import type { Catalog } from "../capabilities/catalog.js";
import { toViews } from "../capabilities/view.js";
import type { Config } from "../config.js";
import { createSandbox } from "../sandbox/sandbox.js";
import { createPageServer } from "../sandbox/server.js";

/** How long teardowns get after the client goes away before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 2000;

/**
 * stdout carries the protocol, so a stray console.log in a binding would
 * corrupt it. Sends every console method to stderr instead, which MCP hosts
 * show as server logs. Call it before loading any bindings. Writes straight
 * to process.stdout are not covered.
 */
export const guardStdout = () => {
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
};

/**
 * Serves the A-JIT tools over MCP on stdio, so any MCP host's chat can build
 * components. Exits when the client disconnects or the process is told to stop.
 */
export const runMcp = async (capabilities: Catalog, config: Config) => {
  const sandbox = createSandbox();
  const page = createPageServer(sandbox, capabilities);
  const mcp = new McpServer({ name: "a-jit", version: "1.0.0" }, { instructions: buildMcpInstructions() });

  for (const t of [...hostTools(toViews(capabilities), page, config.port), ...componentTools(sandbox, capabilities)]) {
    mcp.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args) => {
      const outcome = await executeTool(t, args);
      const value = outcome.ok ? outcome.result : { error: outcome.error };
      return {
        content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
        isError: !outcome.ok,
      };
    });
  }

  // The page server would otherwise keep the process alive after the host
  // has gone, and so would any timers a binding left running.
  let stopping = false;
  const shutdown = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
    try {
      await page.close();
      await mcp.close();
    } catch (err) {
      console.error(err);
    }
    process.exit(0);
  };
  mcp.server.onclose = () => void shutdown();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown());
  }

  await mcp.connect(new StdioServerTransport());
};
