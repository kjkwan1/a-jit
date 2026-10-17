import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCapability, type Capability } from './define.js';
import { toView } from './view.js';

/** Capabilities by name. A Map, so names like `constructor` never reach a prototype. */
export type Catalog = ReadonlyMap<string, Capability>;

/** Dot-separated segments of letters, digits, `_` and `-`, e.g. `weather.hourly`. */
export const CAPABILITY_NAME = /^[\w-]+(\.[\w-]+)*$/;

/** Builds a catalog in code, e.g. for tests. `loadCatalog` builds one from a directory. */
export function catalog(capabilities: Record<string, Capability>): Catalog {
  for (const name of Object.keys(capabilities)) {
    if (!CAPABILITY_NAME.test(name)) {
      throw new Error(`Invalid capability name "${name}"`);
    }
  }
  return new Map(Object.entries(capabilities));
}

/** A file the loader skipped, and why. */
export type LoadError = { file: string; message: string };

const MODULE_FILE = /^(?<name>.+)\.(?:ts|mts|js|mjs)$/;

/** Helpers (`_util.ts`), hidden files, tests and declarations can sit next to bindings. */
const IGNORED_FILE = /^[_.]|\.(?:test|spec)\.m?[jt]s$|\.d\.m?ts$/;

/**
 * Loads a flat directory of bindings. Each file default-exports one
 * capability and names it: `weather.hourly.ts` provides "weather.hourly".
 * Subdirectories are ignored.
 *
 * A file that fails to load is skipped and reported, so one broken binding
 * doesn't take down the rest. Files load in name order.
 */
export async function loadCatalog(dir: string): Promise<{ capabilities: Catalog; errors: LoadError[] }> {
  const filesByName = new Map<string, string[]>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = entry.isFile() && !IGNORED_FILE.test(entry.name) ? MODULE_FILE.exec(entry.name)?.groups?.name : undefined;
    if (name !== undefined) {
      filesByName.set(name, [...(filesByName.get(name) ?? []), entry.name]);
    }
  }

  const capabilities = new Map<string, Capability>();
  const errors: LoadError[] = [];
  for (const name of [...filesByName.keys()].sort()) {
    const files = filesByName.get(name)!;
    if (files.length > 1) {
      // Neither wins: which one loaded would depend on the file system.
      for (const file of files) {
        errors.push({ file, message: `"${name}" is provided by more than one file: ${files.join(', ')}.` });
      }
      continue;
    }

    const file = files[0]!;
    if (!CAPABILITY_NAME.test(name)) {
      errors.push({ file, message: `"${name}" is not a valid name: use letters, digits, "_" and "-", separated by single dots.` });
      continue;
    }
    try {
      const capability = (await import(pathToFileURL(join(dir, file)).href)).default;
      if (!isCapability(capability)) {
        errors.push({ file, message: 'Must default-export request(), stream() or subscribe() from "a-jit".' });
        continue;
      }
      // Fail now rather than in every get_capabilities call.
      toView(name, capability);
      capabilities.set(name, capability);
    } catch (err) {
      errors.push({ file, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { capabilities, errors };
}
