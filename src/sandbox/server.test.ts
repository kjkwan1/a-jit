import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { z } from "zod";
import { manifest, request, stream } from "../manifest/define.js";
import type { BridgeResponse, ComponentEntry, Contract } from "../protocol.js";
import { createSandbox } from "./sandbox.js";
import { IFRAME_CSP, SESSION_HEADER, createPageServer } from "./server.js";

const probe = { counterSignal: undefined as AbortSignal | undefined };

const m = manifest({
  math: {
    add: request({
      description: "Add",
      effect: "none",
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.number(),
      binding: (_, { a, b }) => a + b,
    }),
  },
  counter: stream({
    description: "Counts up",
    output: z.number(),
    binding: async function* ({ signal }) {
      probe.counterSignal = signal;
      for (let n = 0; !signal.aborted; n++) {
        yield n;
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  }),
});

const contract: Contract = {
  sum: { capability: "math.add", start: "demand", keep: "latest", input: { a: 2, b: 3 } },
  count: { capability: "counter", start: "mount", keep: "latest" },
};

const sandbox = createSandbox();
const { server } = createPageServer(sandbox, m);
let base = "";
let host = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `http://${host}`;
});

after(() => {
  server.close();
});

/** A request with full control over headers; fetch() won't let us set Host or Origin. */
const raw = (path: string, { method = "GET", headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });

/** POSTs a bridge message the way the host page does. */
const post = (token: string | undefined, message: unknown, headers: Record<string, string> = {}) =>
  raw("/bridge", {
    method: "POST",
    headers: { Origin: base, ...(token ? { [SESSION_HEADER]: token } : {}), ...headers },
    body: typeof message === "string" ? message : JSON.stringify(message),
  });

/** Opens /events and reads it one event at a time. */
const openEvents = async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/events`, { signal: controller.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  const next = async (): Promise<{ event: string; data: any }> => {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += value;
    }
    const end = buffer.indexOf("\n\n");
    const [eventLine, dataLine] = buffer.slice(0, end).split("\n");
    buffer = buffer.slice(end + 2);
    return { event: eventLine!.slice("event: ".length), data: JSON.parse(dataLine!.slice("data: ".length)) };
  };

  /** Skips events until one named `event` arrives. */
  const nextOf = async (event: string) => {
    for (;;) {
      const e = await next();
      if (e.event === event) return e.data;
    }
  };

  const { token } = await nextOf("session");
  const close = async () => {
    controller.abort();
    await reader.cancel().catch(() => {});
  };
  return { token: token as string, next, nextOf, close };
};

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

test("/events starts with a session token, then sends the component list after every change", async () => {
  const events = await openEvents();
  assert.match(events.token, /^[\w-]{36}$/);
  const find = (list: ComponentEntry[], id: string) => list.find((e) => e.id === id);

  assert.equal(find(await events.nextOf("components"), "live"), undefined);

  sandbox.set("live", "1");
  const first = find(await events.nextOf("components"), "live");
  assert.ok(first);

  sandbox.set("live", "2");
  const second = find(await events.nextOf("components"), "live");
  assert.ok(second && second.version > first.version, "replacing a component bumps its version");

  sandbox.remove("live");
  assert.equal(find(await events.nextOf("components"), "live"), undefined);

  await events.close();
});

test("each connection gets its own session", async () => {
  const [a, b] = await Promise.all([openEvents(), openEvents()]);
  assert.notEqual(a.token, b.token);
  await Promise.all([a.close(), b.close()]);
});

test("requests addressed to any other host are refused", async () => {
  for (const path of ["/", "/events", "/frame.js", "/bridge"]) {
    for (const Host of ["evil.example", "evil.example:80", "localhost.evil.example"]) {
      assert.equal((await raw(path, { headers: { Host } })).status, 403, `${path} with Host ${Host}`);
    }
  }
  for (const Host of [host, `localhost:1`, "[::1]:1"]) {
    assert.equal((await raw("/", { headers: { Host } })).status, 200, Host);
  }
});

test("POST /bridge requires a live session token and our own origin", async () => {
  const events = await openEvents();
  const call = { type: "call", id: 1, component: "nope", key: "sum" };

  assert.equal((await raw("/bridge")).status, 405);
  assert.equal((await post(undefined, call)).status, 401);
  assert.equal((await post("not-a-token", call)).status, 401);
  assert.equal((await post(events.token, call, { Origin: "http://evil.example" })).status, 403);
  assert.equal((await raw("/bridge", { method: "POST", headers: { [SESSION_HEADER]: events.token }, body: "{}" })).status, 403, "no Origin");
  assert.equal((await post(events.token, "{not json")).status, 400);
  assert.equal((await post(events.token, { pad: "x".repeat(70_000) })).status, 413);
  assert.equal((await post(events.token, call)).status, 202);

  // The server learns of the disconnect asynchronously.
  await events.close();
  let status = 0;
  for (let i = 0; i < 100 && status !== 401; i++) {
    status = (await post(events.token, call)).status;
    if (status !== 401) await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(status, 401, "a closed session's token stops working");
});

test("a call's responses arrive on the session's event stream", async () => {
  sandbox.set("calc", "", contract);
  const events = await openEvents();
  assert.equal((await post(events.token, { type: "call", id: 7, component: "calc", key: "sum" })).status, 202);
  const responses: BridgeResponse[] = [await events.nextOf("bridge"), await events.nextOf("bridge")];
  assert.deepEqual(responses, [
    { type: "next", id: 7, data: 5 },
    { type: "done", id: 7 },
  ]);

  await post(events.token, { type: "call", id: 8, component: "calc", key: "missing" });
  assert.equal((await events.nextOf("bridge")).type, "error");
  await events.close();
  sandbox.remove("calc");
});

/** Starts the counter stream for `component` and waits for its first value. */
const startCounter = async (events: Awaited<ReturnType<typeof openEvents>>, component: string) => {
  probe.counterSignal = undefined;
  await post(events.token, { type: "call", id: 1, component, key: "count" });
  assert.equal((await events.nextOf("bridge")).type, "next");
  return probe.counterSignal!;
};

const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; !predicate(); i++) {
    if (i > 200) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

test("closing the event stream cancels the session's calls", async () => {
  sandbox.set("ticker", "", contract);
  const events = await openEvents();
  const signal = await startCounter(events, "ticker");
  await events.close();
  await waitFor(() => signal.aborted);
  sandbox.remove("ticker");
});

test("reset cancels the session's calls", async () => {
  sandbox.set("ticker", "", contract);
  const events = await openEvents();
  const signal = await startCounter(events, "ticker");
  await post(events.token, { type: "reset" });
  await waitFor(() => signal.aborted);
  await events.close();
  sandbox.remove("ticker");
});

test("replacing or removing a component cancels its calls", async () => {
  const events = await openEvents();
  for (const change of [() => sandbox.set("ticker", "", contract), () => sandbox.remove("ticker")]) {
    sandbox.set("ticker", "", contract);
    const signal = await startCounter(events, "ticker");
    change();
    await waitFor(() => signal.aborted);
  }
  await events.close();
});

test("the host page loads its script", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<script src="\/host.js"><\/script>/);
  const res = await fetch(`${base}/host.js`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-security-policy"), null);
  await res.arrayBuffer();
});
