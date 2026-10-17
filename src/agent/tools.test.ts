import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { catalog } from "../capabilities/catalog.js";
import { request } from "../capabilities/define.js";
import { createSandbox } from "../sandbox/sandbox.js";
import { executeTool } from "./tool.js";
import { componentTools } from "./tools.js";

const capabilities = catalog({
  "math.add": request({
    description: "Add",
    effect: "none",
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.number(),
    binding: (_, { a, b }) => a + b,
  }),
});

const setup = () => {
  const sandbox = createSandbox();
  const tools = componentTools(sandbox, capabilities);
  const call = async (name: string, args: unknown) => {
    const outcome = await executeTool(tools.find((t) => t.name === name)!, args);
    return (outcome.ok ? outcome.result : { error: outcome.error }) as any;
  };
  return { sandbox, tools, call };
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
  assert.equal(result.stage, "compile");
  assert.match(result.errors[0].message, /Cannot import "fs"/);
  assert.deepEqual(sandbox.ids(), []);
});

test("submit_component rejects unsafe ids", async () => {
  const { call } = setup();
  assert.match((await call("submit_component", { id: "../x", source: "" })).error, /Invalid arguments/);
});

const source = `import { useData } from "a-jit"; export default function C() { return <p>{useData("sum").value}</p>; }`;

test("submit_component stores the contract with defaults filled in", async () => {
  const { sandbox, call } = setup();
  const contract = { sum: { capability: "math.add", input: { a: 1, b: 2 } } };
  assert.deepEqual(await call("submit_component", { id: "calc", contract, source }), { ok: true, id: "calc" });
  assert.deepEqual(sandbox.entry("calc", "sum"), {
    capability: "math.add",
    start: "demand",
    keep: "latest",
    input: { a: 1, b: 2 },
  });
});

test("submit_component without a contract stores an empty one", async () => {
  const { sandbox, call } = setup();
  await call("submit_component", { id: "plain", source: `export default () => <p>hi</p>;` });
  assert.deepEqual(sandbox.ids(), ["plain"]);
  assert.equal(sandbox.entry("plain", "sum"), undefined);
});

test("submit_component reports contract errors before compiling, and keeps nothing", async () => {
  const { sandbox, call } = setup();
  const contract = { sum: { capability: "math.sub" }, bad: { capability: "math.add", input: { a: "x" } } };
  // The source would fail to compile too; contract errors come first.
  const result = await call("submit_component", { id: "calc", contract, source: "import fs from 'fs';" });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "contract");
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].message, /^sum: unknown capability "math.sub"/);
  assert.deepEqual(sandbox.ids(), []);
});

test("submit_component's schema puts the contract before the source", () => {
  const { tools } = setup();
  const schema = z.toJSONSchema(tools[0]!.input, { io: "input" }) as { properties: Record<string, unknown> };
  assert.deepEqual(Object.keys(schema.properties), ["id", "contract", "source"]);
});
