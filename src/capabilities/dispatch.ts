import type { Capability, Teardown } from './define.js';

// The only place that validates capability input and output, and owns their lifecycle.

function parseOutput(capability: Capability, raw: unknown) {
  return capability.output ? capability.output.parse(raw) : undefined;
}

/**
 * Every kind as one shape: an AsyncIterable of validated outputs. A request
 * yields its result once and ends; streams and subscriptions run until they
 * end or `signal` aborts.
 */
export async function* open(capability: Capability, raw: unknown, signal: AbortSignal): AsyncGenerator<unknown> {
  const args = capability.input ? [capability.input.parse(raw)] : [];
  switch (capability.kind) {
    case 'request': {
      yield parseOutput(capability, await capability.binding({ signal }, ...args));
      return;
    }
    case 'stream': {
      for await (const item of capability.binding({ signal }, ...args)) {
        if (signal.aborted) {
          return;
        }
        yield parseOutput(capability, item);
      }
      return;
    }
    case 'subscribe': {
      yield* subscribe(capability, args, signal);
      return;
    }
  }
}

/** Turns a push-style binding into a pull: emitted events queue until they are read. */
async function* subscribe(capability: Capability & { kind: 'subscribe' }, args: unknown[], signal: AbortSignal) {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let failure: unknown;

  const emit = (event: unknown) => {
    try {
      queue.push(parseOutput(capability, event));
    } catch (err) {
      failure = err;
    }
    wake?.();
  };

  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort);

  let teardown: Teardown = () => {};
  try {
    teardown = await capability.binding({ signal, emit }, ...args);
    while (!signal.aborted) {
      if (failure) {
        throw failure;
      }
      if (queue.length) {
        yield queue.shift();
        continue;
      }
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    await teardown();
  }
}
