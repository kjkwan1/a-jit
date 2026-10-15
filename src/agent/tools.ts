import { z } from "zod";
import type { GroupNode } from "../manifest/define.js";
import type { ManifestView } from "../manifest/view.js";
import { COMPONENT_ID } from "../protocol.js";
import { compileComponent } from "../sandbox/compile.js";
import { ContractSchema, validateContract } from "../sandbox/contract.js";
import type { Sandbox } from "../sandbox/sandbox.js";
import type { PageServer } from "../sandbox/server.js";
import { describeCapabilities } from "./prompt.js";
import { tool } from "./tool.js";

const ComponentId = z
  .string()
  .regex(COMPONENT_ID)
  .describe("Short identifier made of letters, digits, '_' and '-'. Reusing an id replaces that component.");

/** Tools that let the agent manage the components rendered on the page. */
export const componentTools = (sandbox: Sandbox, manifest: GroupNode) => [
  tool({
    name: "submit_component",
    description:
      "Show a Preact TSX component on the user's page. Write its contract first: the live data it uses, by key. " +
      "The contract is checked against the capabilities, then the source is compiled. " +
      "On failure, returns the errors and the stage that failed (\"contract\" or \"compile\"); fix them and submit again.",
    // Property order is generation order: the contract is decided before the code.
    input: z.object({
      id: ComponentId,
      contract: ContractSchema.default({}),
      source: z.string().describe("The component's full TSX source, with a default export."),
    }),
    run: async ({ id, contract, source }) => {
      const contractErrors = validateContract(contract, manifest);
      if (contractErrors.length) {
        return { ok: false, stage: "contract", errors: contractErrors.map((message) => ({ message })) };
      }
      const result = await compileComponent(source, id);
      if (!result.ok) return { ok: false, stage: "compile", errors: result.errors };
      sandbox.set(id, result.code, contract);
      return { ok: true, id };
    },
  }),
  tool({
    name: "list_components",
    description: "List the ids of the components currently on the user's page, in display order.",
    input: z.object({}),
    run: () => ({ ids: sandbox.ids() }),
  }),
  tool({
    name: "remove_component",
    description: "Remove a component from the user's page.",
    input: z.object({ id: ComponentId }),
    run: ({ id }) =>
      sandbox.remove(id) ? { ok: true } : { ok: false, error: `No component with id "${id}".` },
  }),
];

/**
 * Tools for hosts that don't run A-JIT's own prompt (MCP): starting the page,
 * and reading the capability list on demand.
 */
export const hostTools = (view: ManifestView, page: PageServer, port: number) => [
  tool({
    name: "open_sandbox",
    description: "Start the web page that shows components, if it isn't running, and return its URL for the user to open.",
    input: z.object({}),
    run: async () => ({ url: await page.start(port) }),
  }),
  tool({
    name: "get_capabilities",
    description: "Describe the live data and actions this server provides, with their input and output schemas.",
    input: z.object({}),
    run: () => describeCapabilities(view),
  }),
];
