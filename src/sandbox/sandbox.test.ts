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
  assert.deepEqual(sandbox.entries(), [{ id: "a", version: 3 }, { id: "b", version: 2 }]);
  assert.equal(sandbox.code("a"), "3");
  assert.equal(sandbox.remove("missing"), false);
  assert.equal(changes, 3, "removing nothing is not a change");
  off();
  sandbox.remove("a");
  assert.equal(changes, 3);
  assert.deepEqual(sandbox.ids(), ["b"]);
});

test("component ids must be URL- and HTML-safe", () => {
  const sandbox = createSandbox();
  for (const id of ["", "a/b", "../x", "a.b", "</script>", "a b"]) {
    assert.throws(() => sandbox.set(id, ""), /Invalid component id/, JSON.stringify(id));
  }
});
