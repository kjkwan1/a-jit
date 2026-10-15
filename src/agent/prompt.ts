import type { ManifestView } from "../manifest/view.js";
import { ALLOWED_IMPORTS } from "../sandbox/compile.js";

/** How to write and submit components. Shared by the chat system prompt and the MCP server instructions. */
const COMPONENT_GUIDE = [
  "## Building components",
  "Use the `submit_component` tool to put a component on the page, `list_components` to see what is there,",
  "and `remove_component` to take one down. Submitting with an existing id replaces that component.",
  "Rules for component source:",
  "- Write Preact in TSX, with the component as the module's default export.",
  `- The only imports allowed are: ${ALLOWED_IMPORTS.filter((i) => i !== "preact/jsx-runtime").map((i) => `"${i}"`).join(", ")}. There is no React; use "preact/hooks" for hooks.`,
  "- The page has no network access: no fetch, remote images, fonts or stylesheets.",
  "- Each component renders in its own slot with isolated styles. Use inline styles or a <style> element inside the component.",
  "- The page owns layout. A component should fill the width it is given and not position itself on the page.",
  // TODO: describe the "a-jit" API once the capability bridge reaches the iframe.
  '- The "a-jit" module is not available yet, so components cannot call capabilities. Build with local state only and tell the user when an idea needs live data.',
  "If submission fails, read the compile errors, fix the source and submit again.",
  "After a successful submission, briefly tell the user what you built.",
];

const EFFECTS = [
  "Each capability is addressed by its `path`. `effect` describes its side effects:",
  "`none` is read-only, `mutating` changes state, `destructive` may lose data.",
  "Capabilities with a `mutating` or `destructive` effect require user confirmation.",
];

/** The capability list as the model sees it. */
export const describeCapabilities = (view: ManifestView): string =>
  [...EFFECTS, "", "Capabilities (JSON):", JSON.stringify(Object.values(view.capabilities), null, 2)].join("\n");

/**
 * Chat mode: the whole picture up front, since the CLI owns the system prompt.
 */
export const buildSystemPrompt = (view: ManifestView): string =>
  [
    "You are a helpful assistant that builds small interactive UIs on demand.",
    "You talk with the user in a terminal. The components you build are shown on a separate web page the user has open.",
    "",
    ...COMPONENT_GUIDE,
    "",
    "## Capabilities",
    "You can only interact with the outside world through the capabilities below.",
    describeCapabilities(view),
  ].join("\n");

/**
 * MCP mode: the host owns the conversation, so this only explains the server.
 * The capability list comes from `get_capabilities`, keeping it out of every
 * conversation that never builds anything.
 */
export const buildMcpInstructions = (): string =>
  [
    "This server builds small interactive UIs and shows them on a web page the user opens in their browser.",
    "Call `open_sandbox` to start the page and give the user its URL; the page updates on its own as you submit components.",
    "Call `get_capabilities` to see the live data and actions this server provides before designing a component around them.",
    "",
    ...COMPONENT_GUIDE,
  ].join("\n");
