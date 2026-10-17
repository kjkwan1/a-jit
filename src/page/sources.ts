import type { BridgeRequest, BridgeResponse, FrameContract, FrameEntry } from '../protocol.js';

/**
 * The frame's side of capability calls, without any DOM or Preact: one
 * `Source` per contract key of a mounted component, holding the state that
 * `useData(key)` returns.
 */

export type DataStatus = 'idle' | 'loading' | 'open' | 'done' | 'error';

export type DataState = {
  status: DataStatus;
  /** The latest value; during a new run's `loading`, the previous run's. */
  value: unknown;
  /** Values kept from the current run, oldest first, as set by `keep`. */
  values: unknown[];
  error: { message: string } | undefined;
};

const INITIAL: DataState = { status: 'idle', value: undefined, values: [], error: undefined };

const retain = (values: unknown[], value: unknown, keep: FrameEntry['keep']): unknown[] =>
  keep === 'latest' ? [value] : keep === 'all' ? [...values, value] : [...values, value].slice(-keep);

/**
 * Routes calls for the whole frame: allocates call ids, sends requests, and
 * hands each response to the source that made the call.
 */
export const createCalls = (send: (message: BridgeRequest) => void) => {
  const pending = new Map<number, Source>();
  let nextId = 1;

  return {
    start(source: Source, component: string, key: string, input: unknown): number {
      const id = nextId++;
      pending.set(id, source);
      send(input === undefined ? { type: 'call', id, component, key } : { type: 'call', id, component, key, input });
      return id;
    },

    cancel(id: number) {
      if (pending.delete(id)) send({ type: 'cancel', id });
    },

    /** Delivers a response. Responses for calls no longer pending are dropped. */
    receive(message: BridgeResponse) {
      const source = pending.get(message.id);
      if (!source) return;
      if (message.type !== 'next') pending.delete(message.id);
      source.receive(message);
    },

    /** The server's session ended: every pending call is lost. */
    lost() {
      const sources = [...pending.values()];
      pending.clear();
      for (const source of sources) source.lost();
    },
  };
};

export type Calls = ReturnType<typeof createCalls>;

export class Source {
  state: DataState = INITIAL;
  private listeners = new Set<() => void>();
  private callId: number | undefined;
  private settle: ((value: unknown) => void) | undefined;

  constructor(
    private readonly calls: Calls,
    private readonly component: string,
    private readonly key: string,
    readonly entry: FrameEntry,
  ) {}

  /**
   * Starts a run with `input`, or else the entry's default, cancelling the one
   * in progress. Resolves with the latest value when the run ends, however it
   * ends; never rejects.
   */
  run = (input?: unknown): Promise<unknown> => {
    this.stop();
    this.set({ status: 'loading', value: this.state.value, values: [], error: undefined });
    const ended = new Promise<unknown>((resolve) => (this.settle = resolve));
    this.callId = this.calls.start(this, this.component, this.key, input === undefined ? this.entry.input : input);
    return ended;
  };

  /** Stops the run in progress, if any. */
  cancel = () => {
    if (this.stop()) this.set({ ...this.state, status: 'idle' });
  };

  /** Calls `listener` after every state change. Returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @internal Called by `Calls` with a response for this source's call. */
  receive(message: BridgeResponse) {
    switch (message.type) {
      case 'next':
        this.set({
          ...this.state,
          status: 'open',
          value: message.data,
          values: retain(this.state.values, message.data, this.entry.keep),
        });
        return;
      case 'done':
        this.end({ ...this.state, status: 'done' });
        return;
      case 'error':
        this.end({ ...this.state, status: 'error', error: { message: message.message } });
        return;
    }
  }

  /** @internal Called by `Calls` when the session holding this source's call ended. */
  lost() {
    this.end({ ...this.state, status: 'error', error: { message: 'Connection lost' } });
  }

  /** Cancels the call in progress and settles its promise. Returns whether there was one. */
  private stop(): boolean {
    if (this.callId === undefined) return false;
    this.calls.cancel(this.callId);
    this.callId = undefined;
    this.resolve();
    return true;
  }

  private end(state: DataState) {
    this.callId = undefined;
    this.set(state);
    this.resolve();
  }

  private resolve() {
    const settle = this.settle;
    this.settle = undefined;
    settle?.(this.state.value);
  }

  private set(state: DataState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** The sources of one mounted component, one per contract key. */
export const createSourceStore = (component: string, contract: FrameContract, calls: Calls) => {
  const sources = new Map(
    Object.entries(contract).map(([key, entry]) => [key, new Source(calls, component, key, entry)]),
  );

  return {
    get(key: string): Source {
      const source = sources.get(key);
      if (!source) throw new Error(`"${key}" is not in this component's contract.`);
      return source;
    },

    /** Runs every `mount` entry. */
    start() {
      for (const source of sources.values()) {
        if (source.entry.start === 'mount') void source.run();
      }
    },

    /** Cancels everything; called when the component unmounts. */
    dispose() {
      for (const source of sources.values()) source.cancel();
    },
  };
};

export type SourceStore = ReturnType<typeof createSourceStore>;
