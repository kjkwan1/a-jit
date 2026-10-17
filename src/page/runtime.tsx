import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { FrameContract, FrameToHost } from '../protocol';
import { createCalls, createSourceStore, type DataState, type SourceStore } from './sources';

/**
 * The "a-jit" module components import. Calls go to the host page, which
 * relays them to the server; the frame itself has no network access.
 */

const post = (message: FrameToHost) => window.parent.postMessage(message, '*');

/** Every call the frame makes, across all components. The shell feeds it responses. */
export const calls = createCalls((message) => post({ type: 'bridge', message }));

const StoreContext = createContext<SourceStore | null>(null);

/**
 * Gives one mounted component its sources. Mount it once per component
 * version: it starts the `mount` entries when it mounts, and cancels
 * everything when it unmounts.
 */
export function ContractProvider({ id, contract, children }: { id: string; contract: FrameContract; children: ComponentChildren }) {
  const [store] = useState(() => createSourceStore(id, contract, calls));
  // Child effects run first, so the component has subscribed by the time these start.
  useEffect(() => {
    store.start();
    return () => store.dispose();
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export type Data = DataState & {
  run: (input?: unknown) => Promise<unknown>;
  cancel: () => void;
};

/** The current state of a contract entry, re-rendering on every change. */
export function useData(key: string): Data {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useData can only be used inside a component on the page.');
  const source = store.get(key);
  const [state, setState] = useState(source.state);
  useEffect(() => {
    setState(source.state);
    return source.subscribe(() => setState(source.state));
  }, [source]);
  return { ...state, run: source.run, cancel: source.cancel };
}
