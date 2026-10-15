import { COMPONENT_ID, type ComponentEntry, type Contract, type ContractEntry } from "../protocol.js";

export type Sandbox = ReturnType<typeof createSandbox>;

/**
 * The compiled components on the page, by id, in insertion order, each with
 * the contract it was submitted with. Every change bumps a version, which the
 * page uses to tell which scripts to reload, and notifies `onChange` listeners.
 */
export const createSandbox = () => {
  const components = new Map<string, { code: string; contract: Contract; version: number }>();
  const listeners = new Set<() => void>();
  let version = 0;

  const changed = () => {
    for (const listener of listeners) listener();
  };

  return {
    /** Adds or replaces a component. `contract` must already be validated. */
    set(id: string, code: string, contract: Contract = {}) {
      if (!COMPONENT_ID.test(id)) throw new Error(`Invalid component id "${id}"`);
      components.set(id, { code, contract, version: ++version });
      changed();
    },

    remove(id: string): boolean {
      const removed = components.delete(id);
      if (removed) changed();
      return removed;
    },

    code: (id: string): string | undefined => components.get(id)?.code,

    /**
     * The `key` entry of a component's contract. Own-property lookup, so keys
     * like `__proto__` or `constructor` never reach the prototype chain.
     */
    entry(id: string, key: string): ContractEntry | undefined {
      const contract = components.get(id)?.contract;
      return contract && Object.hasOwn(contract, key) ? contract[key] : undefined;
    },

    ids: (): string[] => [...components.keys()],

    entries: (): ComponentEntry[] => [...components].map(([id, { version }]) => ({ id, version })),

    /** Calls `listener` after every change. Returns a function that unsubscribes. */
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
