import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { request, stream, subscribe } from "./define.js";
import { open } from "./dispatch.js";

const collect = async (items: AsyncIterable<unknown>) => {
  const out: unknown[] = [];
  for await (const item of items) out.push(item);
  return out;
};

const signal = () => new AbortController().signal;

test("open: a request yields its validated result once", async () => {
  const add = request({
    description: "Add",
    effect: "none",
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ sum: z.number() }),
    binding: (_, { a, b }) => ({ sum: a + b }),
  });
  assert.deepEqual(await collect(open(add, { a: 2, b: 3 }, signal())), [{ sum: 5 }]);
  await assert.rejects(collect(open(add, { a: "x" }, signal())));
});

test("open: a request without output yields undefined once", async () => {
  const ping = request({ description: "Ping", effect: "none", binding: () => {} });
  assert.deepEqual(await collect(open(ping, undefined, signal())), [undefined]);
});

test("open: a stream yields each validated item", async () => {
  const count = stream({
    description: "Count",
    output: z.number(),
    binding: async function* () {
      yield 1;
      yield 2;
    },
  });
  assert.deepEqual(await collect(open(count, undefined, signal())), [1, 2]);
});

test("open: a subscription yields emitted events until aborted, then tears down", async () => {
  let torndown = false;
  const events = subscribe({
    description: "Events",
    output: z.string(),
    binding: ({ emit }) => {
      emit("a");
      emit("b");
      return () => {
        torndown = true;
      };
    },
  });
  const controller = new AbortController();
  const out: unknown[] = [];
  for await (const item of open(events, undefined, controller.signal)) {
    out.push(item);
    if (out.length === 2) controller.abort();
  }
  assert.deepEqual(out, ["a", "b"]);
  assert.equal(torndown, true);
});
