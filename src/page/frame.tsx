import { render, type ComponentChildren, type ComponentType } from 'preact';
import * as preact from 'preact';
import { createPortal } from 'preact/compat';
import * as hooks from 'preact/hooks';
import { useErrorBoundary, useLayoutEffect, useRef, useState } from 'preact/hooks';
import * as jsxRuntime from 'preact/jsx-runtime';
import { COMPONENT_GLOBAL, type ComponentEntry, type FrameContract, type FrameToHost, type HostToFrame } from '../protocol';
import { calls, ContractProvider, useData } from './runtime';

const components = new Map<string, ComponentType>();

// Compiled components import these by name (sandbox/compile.ts turns each import into a
// lookup here) so they share the shell's copy of Preact, and call `register`
// with their id when their script runs.
(globalThis as any)[COMPONENT_GLOBAL] = {
  'preact': preact,
  'preact/hooks': hooks,
  'preact/jsx-runtime': jsxRuntime,
  // Only what components may use: the shell's internals stay out of reach.
  'a-jit': { useData },
  register: (id: string, Component: ComponentType) => components.set(id, Component),
};

/** A component that throws while rendering takes down only its own slot. */
function Boundary({ children }: { children: ComponentChildren }) {
  const [error] = useErrorBoundary();
  return error ? <p>Component failed: {String(error)}</p> : <>{children}</>;
}

type SlotProps = { id: string; version: number; contract: FrameContract; Component: ComponentType | undefined };

/**
 * One cell of the layout. The component renders into a shadow root (via a portal,
 * so it's still part of this one Preact tree), which scopes its styles.
 */
function Slot({ id, version, contract, Component }: SlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    setShadow(host.current!.attachShadow({ mode: 'open' }));
  }, []);

  return (
    <div class="slot" ref={host}>
      {shadow &&
        createPortal(
          Component ? (
            // The version key remounts a replaced component with fresh sources,
            // which cancels the old version's calls and clears any error.
            <ContractProvider key={version} id={id} contract={contract}>
              <Boundary>
                <Component />
              </Boundary>
            </ContractProvider>
          ) : (
            <p>Failed to load component.</p>
          ),
          shadow,
        )}
    </div>
  );
}

/** Runs a component's script, which calls `register` with its id. Resolves either way. */
const loadScript = ({ id, version }: ComponentEntry) =>
  new Promise<void>((resolve) => {
    const script = document.createElement('script');
    // The version keeps a replaced component from being served from cache.
    script.src = `/components/${id}.js?v=${version}`;
    script.onload = script.onerror = () => {
      script.remove();
      resolve();
    };
    document.head.append(script);
  });

/** Version of each component's code currently in `components`. */
const loaded = new Map<string, number>();

/** Loads whatever changed, then renders the list in order. */
const update = async (entries: ComponentEntry[]) => {
  const ids = new Set(entries.map((e) => e.id));
  for (const id of loaded.keys()) {
    if (!ids.has(id)) {
      loaded.delete(id);
      components.delete(id);
    }
  }

  const stale = entries.filter((e) => loaded.get(e.id) !== e.version);
  for (const { id } of stale) components.delete(id);
  await Promise.all(stale.map(loadScript));
  for (const { id, version } of stale) loaded.set(id, version);

  render(
    <>
      {entries.map(({ id, version, contract }) => (
        // Keyed by id so other slots keep their state.
        <Slot key={id} id={id} version={version} contract={contract} Component={components.get(id)} />
      ))}
    </>,
    document.getElementById('app')!,
  );
};

// Updates are applied one at a time, in the order they arrive.
let queue = Promise.resolve();

window.addEventListener('message', (event: MessageEvent<HostToFrame>) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  switch (message?.type) {
    case 'components':
      queue = queue.then(() => update(message.components));
      return;
    case 'bridge':
      calls.receive(message.message);
      return;
    case 'session':
      calls.lost();
      return;
  }
});

const ready: FrameToHost = { type: 'ready' };
window.parent.postMessage(ready, '*');
