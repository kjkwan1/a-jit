import { build, type Message, type Plugin } from "esbuild";
import { COMPONENT_GLOBAL } from "../protocol.js";

/**
 * Compiles model-written TSX into a single script the sandboxed iframe can run.
 *
 * The component never bundles its own copy of anything. The only imports it may
 * use are in `ALLOWED_IMPORTS`, and each resolves to a stub that reads the live
 * module off `globalThis[COMPONENT_GLOBAL]`. The iframe shell must populate that
 * registry (keyed by import specifier) before running the compiled script, so
 * that the component and the shell share one copy of Preact and its hooks.
 *
 * The output is an IIFE that, as its last step, calls
 * `globalThis[COMPONENT_GLOBAL].register(id, Component)` with the component's
 * `default` export. Registering by id means any number of component scripts can
 * load in any order without sharing a global.
 */

/** Scratch global the IIFE assigns its module namespace to; only read by the register footer. */
export const COMPONENT_EXPORT_GLOBAL = "__ajit_component";

export const ALLOWED_IMPORTS = [
  "a-jit",
  "preact",
  "preact/hooks",
  // Required by the automatic JSX transform.
  "preact/jsx-runtime",
] as const;

export const MAX_SOURCE_LENGTH = 100_000;

export type CompileError = {
  message: string;
  line?: number;
  column?: number;
  lineText?: string;
};

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; errors: CompileError[] };

const ENTRY = "ajit:entry";
const SOURCE = "ajit:component";
const NS_ENTRY = "ajit-entry";
const NS_SOURCE = "ajit-source";
const NS_HOST = "ajit-host";

const allowed = new Set<string>(ALLOWED_IMPORTS);

/**
 * Every import goes through this plugin, so nothing can be loaded from disk or
 * node_modules. Anything outside the allowlist, including relative paths and
 * node built-ins, is a build error.
 */
const sandboxPlugin = (source: string): Plugin => ({
  name: "ajit-sandbox",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point" && args.path === ENTRY) {
        return { path: ENTRY, namespace: NS_ENTRY };
      }
      if (args.namespace === NS_ENTRY && args.path === SOURCE) {
        return { path: SOURCE, namespace: NS_SOURCE };
      }
      if (allowed.has(args.path)) {
        return { path: args.path, namespace: NS_HOST };
      }
      return {
        errors: [
          {
            text: `Cannot import "${args.path}". Allowed imports: ${ALLOWED_IMPORTS.map((i) => `"${i}"`).join(", ")}.`,
          },
        ],
      };
    });

    // The entry re-exports the component's default, so a missing default export
    // surfaces as a build error rather than a runtime surprise in the iframe.
    b.onLoad({ filter: /.*/, namespace: NS_ENTRY }, () => ({
      contents: `export { default } from ${JSON.stringify(SOURCE)};`,
      loader: "js",
    }));

    b.onLoad({ filter: /.*/, namespace: NS_SOURCE }, () => ({
      contents: source,
      loader: "tsx",
    }));

    b.onLoad({ filter: /.*/, namespace: NS_HOST }, (args) => ({
      contents: `module.exports = globalThis[${JSON.stringify(COMPONENT_GLOBAL)}][${JSON.stringify(args.path)}];`,
      loader: "js",
    }));
  },
});

const MISSING_DEFAULT =
  'The component must have a default export, e.g. "export default function Component() { ... }".';

const toCompileError = (m: Message): CompileError => {
  if (/No matching export .*"default"/.test(m.text)) {
    return { message: MISSING_DEFAULT };
  }
  const error: CompileError = { message: m.text };
  if (m.location) {
    error.line = m.location.line;
    error.column = m.location.column;
    error.lineText = m.location.lineText;
  }
  return error;
};

const isBuildFailure = (err: unknown): err is { errors: Message[] } =>
  typeof err === "object" && err !== null && Array.isArray((err as { errors?: unknown }).errors);

export async function compileComponent(source: string, id: string): Promise<CompileResult> {
  if (source.length > MAX_SOURCE_LENGTH) {
    return {
      ok: false,
      errors: [{ message: `Component source is too large (max ${MAX_SOURCE_LENGTH} characters).` }],
    };
  }

  try {
    const result = await build({
      entryPoints: [ENTRY],
      plugins: [sandboxPlugin(source)],
      bundle: true,
      write: false,
      format: "iife",
      globalName: COMPONENT_EXPORT_GLOBAL,
      footer: {
        js: `globalThis[${JSON.stringify(COMPONENT_GLOBAL)}].register(${JSON.stringify(id)}, ${COMPONENT_EXPORT_GLOBAL}.default);`,
      },
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      jsxImportSource: "preact",
      legalComments: "none",
      logLevel: "silent",
    });

    const output = result.outputFiles[0];
    if (!output) {
      return { ok: false, errors: [{ message: "Compilation produced no output." }] };
    }
    return { ok: true, code: output.text };
  } catch (err) {
    if (isBuildFailure(err)) {
      return { ok: false, errors: err.errors.map(toCompileError) };
    }
    throw err;
  }
}
