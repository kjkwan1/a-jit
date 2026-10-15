import { COMPONENT_ID, type ComponentEntry } from "../protocol.js";

export type Sandbox = ReturnType<typeof createSandbox>;

/**
 * The compiled components on the page, by id, in insertion order. Every change
 * bumps a version, which the page uses to tell which scripts to reload, and
 * notifies `onChange` listeners.
 */
export const createSandbox = () => {
  const components = new Map<string, { code: string; version: number }>();
  const listeners = new Set<() => void>();
  let version = 0;

  const changed = () => {
    for (const listener of listeners) listener();
  };

  return {
    set(id: string, code: string) {
      if (!COMPONENT_ID.test(id)) throw new Error(`Invalid component id "${id}"`);
      components.set(id, { code, version: ++version });
      changed();
    },

    remove(id: string): boolean {
      const removed = components.delete(id);
      if (removed) changed();
      return removed;
    },

    code: (id: string): string | undefined => components.get(id)?.code,

    ids: (): string[] => [...components.keys()],

    entries: (): ComponentEntry[] => [...components].map(([id, { version }]) => ({ id, version })),

    /** Calls `listener` after every change. Returns a function that unsubscribes. */
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
