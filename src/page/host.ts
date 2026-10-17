import type { BridgeRequest, ComponentEntry, FrameToHost, HostToFrame } from '../protocol';

/**
 * Host page: the sandboxed frame's only link to the server. It forwards the
 * component list and bridge responses from the server's event stream to the
 * frame, and the frame's calls to `POST /bridge`.
 */

const frame = document.querySelector('iframe')!;
let components: ComponentEntry[] = [];
let ready = false;

// The sandboxed frame has an opaque origin, so it can't be targeted by origin.
const toFrame = (message: HostToFrame) => frame.contentWindow?.postMessage(message, '*');

const sync = () => {
  if (ready) toFrame({ type: 'components', components });
};

// ─── Calls to the server ─────────────────────────────────────────────────────
// Sent one at a time, in order, each waiting for the server's 202, so a cancel
// can never overtake its call.

let token: string | undefined;
let outbox: BridgeRequest[] = [];
let sending = false;

const flush = async () => {
  if (sending) return;
  sending = true;
  while (token && outbox.length) {
    const message = outbox.shift()!;
    try {
      await fetch('/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ajit-Session': token },
        body: JSON.stringify(message),
      });
    } catch {
      // The event stream will reconnect and start a new session; the frame
      // hears about it then.
    }
  }
  sending = false;
};

const send = (message: BridgeRequest) => {
  outbox.push(message);
  void flush();
};

// ─── Wiring ──────────────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<FrameToHost>) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  switch (message?.type) {
    case 'ready':
      // A (re)loaded frame starts with nothing running: drop any calls left
      // over from before.
      send({ type: 'reset' });
      ready = true;
      sync();
      return;
    case 'bridge':
      send(message.message);
      return;
  }
});

// EventSource reconnects on its own. Each connection is a new session, which
// starts by sending its token and the full component list.
const events = new EventSource('/events');

events.addEventListener('session', (event) => {
  const previous = token;
  token = JSON.parse(event.data).token;
  if (previous !== undefined) {
    // The old session's calls died with it, and queued messages belong to it.
    outbox = [];
    toFrame({ type: 'session' });
  }
  void flush();
});

events.addEventListener('components', (event) => {
  components = JSON.parse(event.data);
  sync();
});

events.addEventListener('bridge', (event) => {
  toFrame({ type: 'bridge', message: JSON.parse(event.data) });
});
