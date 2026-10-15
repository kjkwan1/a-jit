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

// ─── Contracts ───────────────────────────────────────────────────────────────

/**
 * How a component uses one capability. Components never see capability paths:
 * they address data by the entry's key in their contract.
 */
export type ContractEntry = {
  /** Manifest path of the capability, e.g. `weather.hourly`. */
  capability: string;
  /** `mount` runs as soon as the component mounts; `demand` waits for `run()`. */
  start: 'mount' | 'demand';
  /** How many received values to retain: the latest, all of them, or the last N. */
  keep: 'latest' | 'all' | number;
  /** Default input for a run. `run(input)` replaces it for that run. */
  input?: unknown;
};

/** A component's contract: its data, by key. */
export type Contract = Record<string, ContractEntry>;

// ─── Host page ↔ sandboxed frame (postMessage) ───────────────────────────────
// The frame can't reach the server itself (its CSP has `connect-src 'none'`),
// so the host relays everything it needs.

export type HostToFrame = { type: 'components'; components: ComponentEntry[] };

/** Sent when the frame's shell is listening, including after a reload. */
export type FrameToHost = { type: 'ready' };

// ─── Capability calls (bridge) ───────────────────────────────────────────────
// Every call is a stream, whatever the capability's kind: a request sends one
// `next` and then `done`.
//   in:   call { id, component, key, input? } | cancel { id } | reset
//   out:  next { id, data }* then done { id } | error { id, message }
// A cancelled call sends nothing more.

export type BridgeRequest =
  /** Runs the `key` entry of `component`'s contract. `input` replaces the entry's default input. */
  | { type: 'call'; id: number; component: string; key: string; input?: unknown }
  | { type: 'cancel'; id: number }
  /** Cancels every call, e.g. when the frame reloads. */
  | { type: 'reset' };

export type BridgeResponse =
  | { type: 'next'; id: number; data: unknown }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string };
