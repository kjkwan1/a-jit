import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildMcpInstructions } from "../agent/prompt.js";
import { executeTool } from "../agent/tool.js";
import { componentTools, hostTools } from "../agent/tools.js";
import type { Config } from "../config.js";
import type { GroupNode } from "../manifest/define.js";
import { asView } from "../manifest/view.js";
import { createSandbox } from "../sandbox/sandbox.js";
import { createPageServer } from "../sandbox/server.js";

/**
 * Serves the A-JIT tools over MCP on stdio, so any MCP host's chat can build
 * components. stdout carries the protocol: nothing else may write to it.
 */
export const runMcp = async (manifest: GroupNode, config: Config) => {
  const view = asView(manifest);
  const sandbox = createSandbox();
  const page = createPageServer(sandbox);
  const mcp = new McpServer({ name: "a-jit", version: "1.0.0" }, { instructions: buildMcpInstructions() });

  for (const t of [...hostTools(view, page, config.port), ...componentTools(sandbox)]) {
    mcp.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args) => {
      const outcome = await executeTool(t, args);
      const value = outcome.ok ? outcome.result : { error: outcome.error };
      return {
        content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
        isError: !outcome.ok,
      };
    });
  }

  await mcp.connect(new StdioServerTransport());
};
