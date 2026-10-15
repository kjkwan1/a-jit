import assert from "node:assert/strict";
import { test } from "node:test";
import { compileComponent } from "../sandbox/compile.js";
import { ContractSchema } from "../sandbox/contract.js";
import { buildMcpInstructions } from "./prompt.js";

test("the prompt's example contract parses and its source compiles", async () => {
  const prompt = buildMcpInstructions();

  const contract = /Contract:\n`([\s\S]*?)`\n/.exec(prompt)?.[1];
  assert.ok(contract, "example contract not found");
  assert.ok(ContractSchema.safeParse(JSON.parse(contract)).success);

  const source = /```tsx\n([\s\S]*?)```/.exec(prompt)?.[1];
  assert.ok(source, "example source not found");
  const result = await compileComponent(source, "example");
  assert.equal(result.ok, true, JSON.stringify(result));
});
