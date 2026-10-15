/**
 * The contract between the Node side and the browser page. Both sides import
 * this file, so it must stay free of dependencies and Node or DOM APIs.
 */

// ─── Components ──────────────────────────────────────────────────────────────

/** Component ids end up in URLs and HTML, so they are restricted to a safe alphabet. */
export const COMPONENT_ID = /^[\w-]+$/;

/** A component on the page. `version` changes whenever its code does. */
export type ComponentEntry = { id: string; version: number };

/**
 * Global the frame fills before running a component: `{ [specifier]: module }`
 * for each allowed import, plus `register(id, Component)`. Compiled components
 * read their imports from it and register themselves on it.
 */
export const COMPONENT_GLOBAL = '__AJIT__';

// ─── Host page ↔ sandboxed frame (postMessage) ───────────────────────────────
// The frame can't reach the server itself (its CSP has `connect-src 'none'`),
// so the host relays everything it needs.

export type HostToFrame = { type: 'components'; components: ComponentEntry[] };

/** Sent when the frame's shell is listening, including after a reload. */
export type FrameToHost = { type: 'ready' };

// ─── Capability calls (bridge) ───────────────────────────────────────────────
//   in:   call { id, path, args } | cancel { id }
//   out:  result { id, data }                 (request)
//         next { id, data }* then done { id } (stream / subscribe)
//         error { id, message }

export type BridgeRequest =
  | { type: 'call'; id: number; path: string; args?: unknown }
  | { type: 'cancel'; id: number };

export type BridgeResponse =
  | { type: 'result'; id: number; data: unknown }
  | { type: 'next'; id: number; data: unknown }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string };
