import assert from "node:assert/strict";
import { test } from "node:test";
import { createSandbox } from "../sandbox/sandbox.js";
import { executeTool } from "./tool.js";
import { componentTools } from "./tools.js";

const setup = () => {
  const sandbox = createSandbox();
  const tools = componentTools(sandbox);
  const call = async (name: string, args: unknown) => {
    const outcome = await executeTool(tools.find((t) => t.name === name)!, args);
    return (outcome.ok ? outcome.result : { error: outcome.error }) as any;
  };
  return { sandbox, call };
};

test("submit_component compiles, shows, replaces and removes components", async () => {
  const { sandbox, call } = setup();
  const source = `export default function C() { return <p>hi</p>; }`;
  assert.deepEqual(await call("submit_component", { id: "greeting", source }), { ok: true, id: "greeting" });
  assert.deepEqual(await call("submit_component", { id: "greeting", source }), { ok: true, id: "greeting" });
  assert.deepEqual(sandbox.ids(), ["greeting"]);
  assert.deepEqual(await call("list_components", {}), { ids: ["greeting"] });

  assert.deepEqual(await call("remove_component", { id: "greeting" }), { ok: true });
  assert.equal((await call("remove_component", { id: "greeting" })).ok, false);
  assert.deepEqual(sandbox.ids(), []);
});

test("submit_component returns compile errors and keeps nothing", async () => {
  const { sandbox, call } = setup();
  const result = await call("submit_component", { id: "bad", source: `import x from "fs"; export default x;` });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /Cannot import "fs"/);
  assert.deepEqual(sandbox.ids(), []);
});

test("submit_component rejects unsafe ids", async () => {
  const { call } = setup();
  assert.match((await call("submit_component", { id: "../x", source: "" })).error, /Invalid arguments/);
});
