import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { catalog } from "../capabilities/catalog.js";
import { request, stream } from "../capabilities/define.js";
import { ContractSchema, validateContract } from "./contract.js";

const capabilities = catalog({
  "weather.hourly": request({
    description: "Hourly weather",
    effect: "none",
    input: z.object({ latitude: z.number(), longitude: z.number() }),
    output: z.object({ temperature: z.array(z.number()) }),
    binding: () => ({ temperature: [] }),
  }),
  // Every input field is optional, so it can run without input.
  "weather.current": request({
    description: "Current weather",
    effect: "none",
    input: z.object({ units: z.enum(["c", "f"]).optional() }).optional(),
    binding: () => {},
  }),
  "lights.toggle": request({ description: "Toggle the lights", effect: "mutating", binding: () => {} }),
  ping: stream({
    description: "Ping",
    output: z.string(),
    binding: async function* () {},
  }),
});

const check = (contract: unknown) => validateContract(ContractSchema.parse(contract), capabilities);

test("the schema fills in defaults", () => {
  assert.deepEqual(ContractSchema.parse({ p: { capability: "ping" } }), {
    p: { capability: "ping", start: "demand", keep: "latest" },
  });
});

test("the schema rejects unknown fields, bad values and non-identifier keys", () => {
  for (const contract of [
    { p: { capability: "ping", refresh: 1000 } },
    { p: { capability: "ping", start: "eager" } },
    { p: { capability: "ping", keep: 0 } },
    { p: { capability: "ping", keep: "first" } },
    { "my-data": { capability: "ping" } },
    { p: {} },
  ]) {
    assert.equal(ContractSchema.safeParse(contract).success, false, JSON.stringify(contract));
  }
});

test("a valid contract has no errors", () => {
  assert.deepEqual(
    check({
      forecast: { capability: "weather.hourly", start: "mount", input: { latitude: 1, longitude: 2 } },
      lookup: { capability: "weather.hourly" },
      now: { capability: "weather.current", start: "mount" },
      pings: { capability: "ping", start: "mount", keep: 20 },
    }),
    [],
  );
});

test("an empty contract is valid", () => {
  assert.deepEqual(check({}), []);
});

test("unknown capabilities are reported, prototype-chain paths included", () => {
  const errors = check({
    a: { capability: "weather.daily" },
    b: { capability: "constructor" },
    c: { capability: "__proto__" },
    d: { capability: "weather" },
  });
  assert.equal(errors.length, 4);
  assert.match(errors[0]!, /^a: unknown capability "weather.daily"/);
});

test("capabilities that change state are rejected for now", () => {
  const [error] = check({ toggle: { capability: "lights.toggle" } });
  assert.match(error!, /^toggle: "lights.toggle" is mutating/);
});

test("input is checked against the capability's schema", () => {
  const [error] = check({ f: { capability: "weather.hourly", input: { latitude: "north" } } });
  assert.match(error!, /^f: has invalid input for "weather.hourly"/);
  assert.match(check({ p: { capability: "ping", input: 1 } })[0]!, /takes no input/);
});

test("a mount entry must have the input it needs", () => {
  const [error] = check({ f: { capability: "weather.hourly", start: "mount" } });
  assert.match(error!, /^f: starts on mount without input, but "weather.hourly" needs input:/);
});
