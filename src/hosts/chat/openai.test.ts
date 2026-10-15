import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { tool } from "../../agent/tool.js";
import { runTool, toOpenAITool } from "./openai.js";

const echo = tool({
  name: "echo",
  description: "Echo",
  input: z.object({ text: z.string() }),
  run: ({ text }) => ({ text }),
});

const throws = tool({
  name: "throws",
  description: "Throws",
  input: z.object({}),
  run: () => {
    throw new Error("boom");
  },
});

const call = async (name: string, args: unknown) =>
  JSON.parse(await runTool([echo, throws], name, JSON.stringify(args)));

test("exposes the input schema as JSON Schema parameters", () => {
  const { function: fn } = toOpenAITool(echo);
  assert.equal(fn.name, "echo");
  assert.equal(fn.parameters?.type, "object");
  assert.deepEqual(fn.parameters?.required, ["text"]);
  assert.equal("$schema" in (fn.parameters ?? {}), false);
});

test("runs a tool with valid arguments", async () => {
  assert.deepEqual(await call("echo", { text: "hi" }), { text: "hi" });
});

test("reports problems as error results instead of throwing", async () => {
  assert.match((await call("nope", {})).error, /Unknown tool "nope"/);
  assert.match((await call("echo", { text: 1 })).error, /Invalid arguments/);
  assert.match((await call("throws", {})).error, /boom/);
  assert.match(JSON.parse(await runTool([echo], "echo", "{not json")).error, /not valid JSON/);
});
