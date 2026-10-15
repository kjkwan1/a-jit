import type { RuntimeCapabilityNode, Teardown } from './define.js';

// The only place that validates capability input and output, and owns their lifecycle.

function parseInput(node: RuntimeCapabilityNode, raw: unknown) {
  return node.input ? [node.input.parse(raw)] : [];
}

function parseOutput(node: RuntimeCapabilityNode, raw: unknown) {
  return node.output ? node.output.parse(raw) : undefined;
}

export async function dispatchRequest(node: RuntimeCapabilityNode & { kind: 'request' }, raw: unknown, signal: AbortSignal) {
  const res = await node.binding({ signal }, ...parseInput(node, raw));
  return parseOutput(node, res);
}

export async function* dispatchStream(
  node: RuntimeCapabilityNode & { kind: 'stream' },
  raw: unknown,
  signal: AbortSignal,
) {
  for await (const item of node.binding({ signal }, ...parseInput(node, raw))) {
    if (signal.aborted) {
      return;
    }
    yield parseOutput(node, item);
  }
}

/** Normalizes push-style bindings into an AsyncIterable so consumers see two shapes, not three. */
export async function* dispatchSubscribe(
  node: RuntimeCapabilityNode & { kind: 'subscribe' },
  raw: unknown,
  signal: AbortSignal,
) {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let failure: unknown;

  const emit = (event: unknown) => {
    try {
      queue.push(parseOutput(node, event));
    } catch (err) {
      failure = err;
    }
    wake?.();
  };

  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort);

  let teardown: Teardown = () => {};
  try {
    teardown = await node.binding({ signal, emit }, ...parseInput(node, raw));
    while (!signal.aborted) {
      if (failure) throw failure;
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

