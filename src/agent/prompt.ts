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
  "- The page has no network access: no fetch, remote images, fonts or stylesheets. Live data comes only through the contract (below).",
  "- Each component renders in its own slot with isolated styles. Use inline styles or a <style> element inside the component.",
  "- The page owns layout. A component should fill the width it is given and not position itself on the page.",
  "If submission fails, the result says which stage failed (`contract` or `compile`) and why. Fix it and submit again.",
  "After a successful submission, briefly tell the user what you built.",
];

/** The contract vocabulary and the `a-jit` runtime. */
const DATA_GUIDE = [
  "## Using live data",
  "Decide what data a component needs before writing it, and declare it in the `contract` argument of `submit_component`:",
  "an object mapping keys you choose to capability entries. The component reads each one by its key; it never uses capability paths.",
  "Entry fields:",
  "- `capability`: the capability's path.",
  '- `start`: `"mount"` runs as soon as the component appears; `"demand"` (default) waits until the component calls `run()`.',
  '  Use mount for data shown right away, demand for data fetched after an interaction or with input the user picks.',
  '- `keep`: how many values to keep: `"latest"` (default), `"all"`, or a number N for the last N (e.g. a chart of a stream).',
  "- `input`: default input, matching the capability's input schema. A mount entry must include any input the capability requires.",
  "Every capability arrives the same way, as a stream of values: a request delivers one value and is done;",
  "a stream or subscription keeps delivering until cancelled. One capability may appear under several keys with different settings.",
  'Only read-only capabilities (effect `none`) can be used for now. If the user wants a component that changes something, say that isn\'t supported yet.',
  "",
  'In the component, `import { useData } from "a-jit"` and call `useData(key)`. It returns:',
  '- `status`: `"idle"` (not running), `"loading"` (running, no value yet), `"open"` (receiving values), `"done"` or `"error"`.',
  "- `value`: the latest value. While a new run is loading, it still holds the previous run's value.",
  "- `values`: the values kept from the current run, oldest first, as set by `keep`.",
  '- `error`: `{ message }` when status is `"error"`.',
  "- `run(input?)`: starts the entry with `input`, or else the contract's default, cancelling that key's run in progress.",
  "  It returns a promise of the latest value once the run ends, so you can `await` it in an event handler.",
  '- `cancel()`: stops the current run; status becomes `"idle"`.',
  "`useData` throws for a key that is not in the contract.",
  "",
  "Example, with illustrative capability paths. Contract:",
  '`{ "quote": { "capability": "stocks.quote", "start": "mount", "input": { "symbol": "AAPL" } },',
  '   "ticks": { "capability": "stocks.ticks", "start": "mount", "keep": 20 } }`',
  "Source:",
  "```tsx",
  'import { useData } from "a-jit";',
  "",
  "export default function Quote() {",
  '  const quote = useData("quote");',
  '  const ticks = useData("ticks");',
  "  return (",
  "    <div>",
  '      {quote.status === "loading" && <p>Loading…</p>}',
  '      {quote.status === "error" && <p>{quote.error.message}</p>}',
  "      {quote.value && <h2>{quote.value.symbol}: {quote.value.price}</h2>}",
  '      <button onClick={() => quote.run({ symbol: "MSFT" })}>Show MSFT</button>',
  "      <p>Last {ticks.values.length} ticks: {ticks.values.map((t) => t.price).join(\", \")}</p>",
  "    </div>",
  "  );",
  "}",
  "```",
];

const EFFECTS = [
  "Each capability is addressed by its `path`. `effect` describes its side effects:",
  "`none` is read-only, `mutating` changes state, `destructive` may lose data.",
  "Components can only use capabilities whose effect is `none` for now.",
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
    ...DATA_GUIDE,
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
    "Call `get_capabilities` to see the live data and actions this server provides before writing a component's contract.",
    "",
    ...COMPONENT_GUIDE,
    "",
    ...DATA_GUIDE,
  ].join("\n");
