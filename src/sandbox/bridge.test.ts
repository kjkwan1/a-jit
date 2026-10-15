import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { manifest, request, stream, subscribe } from "../manifest/define.js";
import type { BridgeResponse } from "../protocol.js";
import { createBridge } from "./bridge.js";
import { createSandbox } from "./sandbox.js";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(id), resolve()), { once: true });
  });

const waitFor = async (predicate: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
};

const probe = { streamSignal: undefined as AbortSignal | undefined, torndown: false };

const m = manifest({
  math: {
    add: request({
      description: "Add two numbers",
      effect: "none",
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.object({ sum: z.number() }),
      binding: (_, { a, b }) => ({ sum: a + b }),
    }),
  },
  live: {
    counter: stream({
      description: "Counts up",
      output: z.object({ n: z.number() }),
      binding: async function* (opts) {
        probe.streamSignal = opts.signal;
        let n = 0;
        while (!opts.signal.aborted) {
          yield { n: n++ };
          await sleep(5, opts.signal);
        }
      },
    }),
    events: subscribe({
      description: "Emits events",
      output: z.object({ message: z.string() }),
      binding: ({ emit }) => {
        const id = setInterval(() => emit({ message: "hi" }), 5);
        return () => {
          clearInterval(id);
          probe.torndown = true;
        };
      },
    }),
  },
});

// The contract is stored as-is: validateContract is tested on its own, and
// "ghost" checks what the bridge does if an entry's capability is missing.
const contract = {
  sum: { capability: "math.add", start: "demand", keep: "latest", input: { a: 2, b: 3 } },
  counter: { capability: "live.counter", start: "mount", keep: "latest" },
  events: { capability: "live.events", start: "mount", keep: "all" },
  ghost: { capability: "math.nope", start: "demand", keep: "latest" },
} as const;

const setup = () => {
  const sandbox = createSandbox();
  sandbox.set("c", "", contract);
  const sent: BridgeResponse[] = [];
  const bridge = createBridge(m, sandbox.entry, (msg) => void sent.push(msg));
  return { bridge, sent };
};

const call = (id: number, key: string, input?: unknown) => ({ type: "call", id, component: "c", key, input });

test("request: streams one validated value, then done", async () => {
  const { bridge, sent } = setup();
  await bridge.handle(call(1, "sum"));
  assert.deepEqual(sent, [
    { type: "next", id: 1, data: { sum: 5 } },
    { type: "done", id: 1 },
  ]);
});

test("input replaces the entry's default input", async () => {
  const { bridge, sent } = setup();
  await bridge.handle(call(1, "sum", { a: 10, b: 1 }));
  assert.deepEqual(sent[0], { type: "next", id: 1, data: { sum: 11 } });
});

test("keys outside the contract, including prototype-chain ones, reply with an error", async () => {
  const { bridge, sent } = setup();
  for (const key of ["nope", "constructor", "__proto__", "toString"]) {
    await bridge.handle(call(1, key));
  }
  await bridge.handle({ type: "call", id: 2, component: "other", key: "sum" });
  assert.deepEqual(sent.map((s) => s.type), ["error", "error", "error", "error", "error"]);
  assert.match((sent[0] as { message: string }).message, /no contract entry "nope"/);
});

test("an entry whose capability is missing replies with an error", async () => {
  const { bridge, sent } = setup();
  await bridge.handle(call(1, "ghost"));
  assert.deepEqual(sent, [{ type: "error", id: 1, message: 'Unknown capability "math.nope".' }]);
});

test("invalid input replies with an error", async () => {
  const { bridge, sent } = setup();
  await bridge.handle(call(1, "sum", { a: "x" }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.type, "error");
});

test("stream: yields next messages, and cancel stops them without a done", async () => {
  const { bridge, sent } = setup();
  const pending = bridge.handle(call(1, "counter"));
  await waitFor(() => sent.length >= 2);
  await bridge.handle({ type: "cancel", id: 1 });
  await pending;

  assert.equal(probe.streamSignal!.aborted, true);
  assert.ok(sent.every((s) => s.type === "next"), JSON.stringify(sent));
  const count = sent.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, count, "no messages after cancel");
});

test("subscribe: close() tears the subscription down", async () => {
  const { bridge, sent } = setup();
  const pending = bridge.handle(call(1, "events"));
  await waitFor(() => sent.length >= 1);
  assert.deepEqual((sent[0] as { data: unknown }).data, { message: "hi" });
  bridge.close();
  await pending;
  assert.equal(probe.torndown, true);
});

test("malformed messages are ignored", async () => {
  const { bridge, sent } = setup();
  for (const junk of [null, 42, "call", {}, { type: "call" }, { type: "call", id: "1", component: "c", key: "sum" }, { type: "call", id: 1, component: "c", key: 7 }, { type: "call", id: 1, key: "sum" }]) {
    await bridge.handle(junk);
  }
  assert.equal(sent.length, 0);
});
