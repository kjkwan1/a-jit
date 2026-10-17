import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { catalog, loadCatalog } from "./catalog.js";
import { request } from "./define.js";

// Fixtures build the brand by hand, as a binding compiled against another copy
// of a-jit would, so they need no imports.
const capability = (description: string) => `export default {
  [Symbol.for("a-jit.capability")]: true,
  kind: "request",
  description: ${JSON.stringify(description)},
  effect: "none",
  tags: [],
  binding: () => {},
};
`;

let dir = "";

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "a-jit-catalog-"));
  const files: Record<string, string> = {
    "weather.hourly.mjs": capability("Hourly"),
    "ping.ts": capability("Ping") + "const typed: number = 1;\n",
    "_helpers.mjs": "throw new Error('helpers must not load');",
    ".hidden.mjs": "throw new Error('hidden files must not load');",
    "ping.test.ts": "throw new Error('tests must not load');",
    "types.d.ts": "export {};",
    "notes.md": "not code",
    "plain.mjs": "export default { kind: 'request' };",
    "broken.mjs": "throw new Error('boom');",
    "twice.mjs": capability("Twice, as JS"),
    "twice.ts": capability("Twice, as TS"),
    "a..b.mjs": capability("Empty segment"),
  };
  for (const [file, contents] of Object.entries(files)) {
    await writeFile(join(dir, file), contents);
  }
  await mkdir(join(dir, "nested"));
  await writeFile(join(dir, "nested", "deep.mjs"), capability("Nested"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("loadCatalog names each capability by its file and skips everything else", async () => {
  const { capabilities } = await loadCatalog(dir);
  assert.deepEqual([...capabilities.keys()], ["ping", "weather.hourly"]);
  assert.equal(capabilities.get("weather.hourly")!.description, "Hourly");
});

test("loadCatalog reports files it could not use, without failing the rest", async () => {
  const { errors } = await loadCatalog(dir);
  const byFile = new Map(errors.map((e) => [e.file, e.message]));
  assert.deepEqual([...byFile.keys()].sort(), ["a..b.mjs", "broken.mjs", "plain.mjs", "twice.mjs", "twice.ts"]);
  assert.match(byFile.get("broken.mjs")!, /boom/);
  assert.match(byFile.get("plain.mjs")!, /Must default-export/);
  assert.match(byFile.get("twice.ts")!, /more than one file: twice\.mjs, twice\.ts/);
  assert.match(byFile.get("a..b.mjs")!, /not a valid name/);
});

test("loadCatalog rejects a capability whose schema has no JSON Schema form", async () => {
  const bad = await mkdtemp(join(tmpdir(), "a-jit-catalog-"));
  try {
    await writeFile(
      join(bad, "when.mjs"),
      // The temp dir has no node_modules, so zod is imported by its resolved URL.
      `import { z } from ${JSON.stringify(import.meta.resolve("zod"))};
export default {
  [Symbol.for("a-jit.capability")]: true,
  kind: "request", description: "When", effect: "none", tags: [],
  output: z.date(),
  binding: () => new Date(),
};
`,
    );
    const { capabilities, errors } = await loadCatalog(bad);
    assert.equal(capabilities.size, 0);
    assert.match(errors[0]!.message, /Date cannot be represented/);
  } finally {
    await rm(bad, { recursive: true, force: true });
  }
});

test("the example bindings all load", async () => {
  const { capabilities, errors } = await loadCatalog(new URL("../../examples/bindings/", import.meta.url).pathname);
  assert.deepEqual(errors, []);
  assert.deepEqual([...capabilities.keys()], ["camera.telemetry", "garden.telemetry", "nas.telemetry", "weather.hourly"]);
});

test("catalog() checks names and never resolves through the prototype chain", () => {
  const ping = request({ description: "Ping", effect: "none", binding: () => {} });
  const capabilities = catalog({ "net.ping": ping });
  assert.equal(capabilities.get("net.ping"), ping);
  for (const name of ["constructor", "__proto__", "toString", "net"]) {
    assert.equal(capabilities.get(name), undefined, name);
  }
  for (const name of ["", "a/b", ".a", "a.", "a..b", "a b"]) {
    assert.throws(() => catalog({ [name]: ping }), /Invalid capability name/, JSON.stringify(name));
  }
});
