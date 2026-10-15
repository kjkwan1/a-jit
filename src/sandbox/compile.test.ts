import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { COMPONENT_GLOBAL } from "../protocol.js";
import { ALLOWED_IMPORTS, MAX_SOURCE_LENGTH, compileComponent } from "./compile.js";

const compileOk = async (source: string) => {
  const result = await compileComponent(source, "test");
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { ok: true; code: string }).code;
};

const compileFail = async (source: string) => {
  const result = await compileComponent(source, "test");
  assert.equal(result.ok, false, "expected compilation to fail");
  return (result as { ok: false; errors: { message: string; line?: number }[] }).errors;
};

test("compiles TSX that uses the allowed imports", async () => {
  const code = await compileOk(`
    import { useState } from "preact/hooks";
    import { useCapability, runtime } from "a-jit";
    export default function Component(): any {
      const [n] = useState<number>(0);
      return <p>{n}</p>;
    }
  `);
  // Stubs read from the shell's registry; nothing is bundled in.
  assert.ok(code.includes(COMPONENT_GLOBAL));
  assert.ok(code.length < 5_000, `unexpectedly large output (${code.length} bytes)`);
});

test("compiled output runs against the host registry and registers the component by id", async () => {
  const code = await compileOk(`
    import { useState } from "preact/hooks";
    export default function Component() {
      const [n] = useState(41);
      return <b>{n + 1}</b>;
    }
  `);


  const registered: { id: string; Component: () => unknown }[] = [];
  const context = vm.createContext({
    [COMPONENT_GLOBAL]: {
      register: (id: string, Component: () => unknown) => registered.push({ id, Component }),
      "preact/hooks": { useState: (v: unknown) => [v, () => {}] },
      "preact/jsx-runtime": {
        jsx: (type: unknown, props: unknown) => ({ type, props }),
        jsxs: (type: unknown, props: unknown) => ({ type, props }),
        Fragment: Symbol.for("fragment"),
      },
    },
  });
  vm.runInContext(code, context);

  assert.equal(registered.length, 1);
  assert.equal(registered[0]!.id, "test");
  // Round-trip through JSON: the value was built in another vm realm.
  assert.deepEqual(JSON.parse(JSON.stringify(registered[0]!.Component())), { type: "b", props: { children: 42 } });
});

test("rejects imports outside the allowlist", async () => {
  for (const specifier of ["lodash", "react", "node:fs", "fs", "./other", "../other", "/etc/passwd", "https://evil.example/x.js"]) {
    const errors = await compileFail(`
      import x from ${JSON.stringify(specifier)};
      export default function C() { return x; }
    `);
    assert.match(errors[0]!.message, /Cannot import/, specifier);
    assert.ok(errors[0]!.message.includes(specifier), specifier);
  }
});

test("rejects require() and dynamic import() of disallowed modules", async () => {
  await compileFail(`
    export default function C() { return require("fs"); }
  `);
  await compileFail(`
    export const load = () => import("lodash");
    export default function C() { return null; }
  `);
});

test("error message lists the allowed imports", async () => {
  const [error] = await compileFail(`import x from "lodash"; export default x;`);
  for (const allowed of ALLOWED_IMPORTS) assert.ok(error!.message.includes(allowed), allowed);
});

test("reports syntax errors with a location", async () => {
  const [error] = await compileFail(`export default function C() {\n  return <div>;\n}`);
  assert.equal(typeof error!.line, "number");
});

test("reports a missing default export clearly", async () => {
  const [error] = await compileFail(`export const Component = () => null;`);
  assert.match(error!.message, /default export/);
});

test("rejects oversized source", async () => {
  const [error] = await compileFail("x".repeat(MAX_SOURCE_LENGTH + 1));
  assert.match(error!.message, /too large/);
});
