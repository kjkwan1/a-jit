import type { ComponentEntry, FrameToHost, HostToFrame } from '../protocol';

/**
 * Host page: follows the server's component list over SSE and forwards it to
 * the sandboxed frame whenever it changes.
 */

const frame = document.querySelector('iframe')!;
let components: ComponentEntry[] = [];
let ready = false;

const sync = () => {
  if (!ready) return;
  const message: HostToFrame = { type: 'components', components };
  // The sandboxed frame has an opaque origin, so it can't be targeted by origin.
  // The message only carries component ids and versions.
  frame.contentWindow?.postMessage(message, '*');
};

window.addEventListener('message', (event: MessageEvent<FrameToHost>) => {
  if (event.source !== frame.contentWindow) return;
  if (event.data?.type === 'ready') {
    ready = true;
    sync();
  }
});

// EventSource reconnects on its own; the server resends the full list on connect.
new EventSource('/events').addEventListener('components', (event) => {
  components = JSON.parse(event.data);
  sync();
});
