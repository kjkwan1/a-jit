import { z } from "zod";
import type { ManifestView } from "../manifest/view.js";
import { COMPONENT_ID } from "../protocol.js";
import { compileComponent } from "../sandbox/compile.js";
import type { Sandbox } from "../sandbox/sandbox.js";
import type { PageServer } from "../sandbox/server.js";
import { describeCapabilities } from "./prompt.js";
import { tool } from "./tool.js";

const ComponentId = z
  .string()
  .regex(COMPONENT_ID)
  .describe("Short identifier made of letters, digits, '_' and '-'. Reusing an id replaces that component.");

/** Tools that let the agent manage the components rendered on the page. */
export const componentTools = (sandbox: Sandbox) => [
  tool({
    name: "submit_component",
    description:
      "Compile a Preact TSX component and show it on the user's page. " +
      "On failure, returns the compile errors; fix them and submit again.",
    input: z.object({
      id: ComponentId,
      source: z.string().describe("The component's full TSX source, with a default export."),
    }),
    run: async ({ id, source }) => {
      const result = await compileComponent(source, id);
      if (!result.ok) return { ok: false, errors: result.errors };
      sandbox.set(id, result.code);
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
