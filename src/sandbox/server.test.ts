import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createSandbox } from "./sandbox.js";
import { IFRAME_CSP, createPageServer } from "./server.js";

const sandbox = createSandbox();
const { server } = createPageServer(sandbox);
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const directive = (name: string) =>
  IFRAME_CSP.split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));

test("the frame document and script are served with the lockdown CSP", async () => {
  for (const path of ["/frame.html", "/frame.js"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("content-security-policy"), IFRAME_CSP, path);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
    await res.arrayBuffer();
  }
});

test("the CSP blocks every outbound channel except postMessage", () => {
  assert.equal(directive("sandbox"), "sandbox allow-scripts");
  assert.equal(directive("default-src"), "default-src 'none'");
  assert.equal(directive("connect-src"), "connect-src 'none'");
  assert.equal(directive("form-action"), "form-action 'none'");
  assert.equal(directive("worker-src"), "worker-src 'none'");
  assert.equal(directive("script-src"), "script-src 'self'");
  assert.ok(!IFRAME_CSP.includes("unsafe-eval"));
  assert.ok(!IFRAME_CSP.includes("allow-same-origin"));
});

test("the host page is not given the frame policy", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get("content-security-policy"), null);
  await res.arrayBuffer();
});

test("unknown paths 404", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  await res.arrayBuffer();
});

test("components are served by id with the lockdown CSP", async () => {
  sandbox.set("alpha", "console.log('alpha');");

  const res = await fetch(`${base}/components/alpha.js?v=1`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-security-policy"), IFRAME_CSP);
  assert.equal(await res.text(), "console.log('alpha');");

  assert.equal((await fetch(`${base}/components/missing.js`)).status, 404);
});

test("/events sends the component list on connect and after every change", async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/events`, { signal: controller.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");

  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const nextEvent = async () => {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += value;
    }
    const end = buffer.indexOf("\n\n");
    const event = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    assert.match(event, /^event: components\n/);
    return JSON.parse(event.slice(event.indexOf("data: ") + 6)) as { id: string; version: number }[];
  };
  const find = (list: { id: string; version: number }[], id: string) => list.find((e) => e.id === id);

  assert.equal(find(await nextEvent(), "live"), undefined);

  sandbox.set("live", "1");
  const first = find(await nextEvent(), "live");
  assert.ok(first);

  sandbox.set("live", "2");
  const second = find(await nextEvent(), "live");
  assert.ok(second && second.version > first.version, "replacing a component bumps its version");

  sandbox.remove("live");
  assert.equal(find(await nextEvent(), "live"), undefined);

  controller.abort();
  await reader.cancel().catch(() => {});
});

test("the host page loads its script", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<script src="\/host.js"><\/script>/);
  const res = await fetch(`${base}/host.js`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-security-policy"), null);
  await res.arrayBuffer();
});
