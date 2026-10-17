import assert from "node:assert/strict";
import { test } from "node:test";
import { createSandbox } from "./sandbox.js";

test("changes bump the version and notify listeners", () => {
  const sandbox = createSandbox();
  let changes = 0;
  const off = sandbox.onChange(() => changes++);
  sandbox.set("a", "1");
  sandbox.set("b", "2");
  sandbox.set("a", "3");
  assert.deepEqual(sandbox.entries(), [
    { id: "a", version: 3, contract: {} },
    { id: "b", version: 2, contract: {} },
  ]);
  assert.equal(sandbox.code("a"), "3");
  assert.equal(sandbox.remove("missing"), false);
  assert.equal(changes, 3, "removing nothing is not a change");
  off();
  sandbox.remove("a");
  assert.equal(changes, 3);
  assert.deepEqual(sandbox.ids(), ["b"]);
});

test("the page gets each contract without capability paths", () => {
  const sandbox = createSandbox();
  sandbox.set("w", "", { now: { capability: "weather.hourly", start: "mount", keep: 3, input: { city: "Oslo" } } });
  assert.deepEqual(sandbox.entries()[0]!.contract, { now: { start: "mount", keep: 3, input: { city: "Oslo" } } });
});

test("component ids must be URL- and HTML-safe", () => {
  const sandbox = createSandbox();
  for (const id of ["", "a/b", "../x", "a.b", "</script>", "a b"]) {
    assert.throws(() => sandbox.set(id, ""), /Invalid component id/, JSON.stringify(id));
  }
});
