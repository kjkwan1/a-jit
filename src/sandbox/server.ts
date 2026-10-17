import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Catalog } from "../capabilities/catalog.js";
import { createBridge, type Bridge } from "./bridge.js";
import type { Sandbox } from "./sandbox.js";

/**
 * The iframe runs model-generated code. `sandbox` isolates its origin, but on
 * its own does nothing to stop it from calling fetch(), opening sockets or
 * loading remote images. This policy closes those channels so that
 * `postMessage` to the host is the only way out.
 *
 * - `sandbox allow-scripts` is repeated here so the restriction also holds if
 *   the document is opened directly instead of through the host's <iframe>.
 * - `script-src 'self'` (no `unsafe-eval`) permits only our own bundles.
 * - `style-src 'unsafe-inline'` lets components ship <style> tags; with
 *   `img-src data:` and no `font-src` there is nowhere for CSS to fetch from.
 */
export const IFRAME_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * The bundled page: `npm run build` puts it in dist/page. Both src/sandbox and
 * dist/sandbox sit two levels below the package root, so this resolves the
 * same way under tsx and from the build.
 */
const PAGE_DIR = new URL("../../dist/page/", import.meta.url);

type Route = {
  file: string;
  type: string;
  headers?: Record<string, string>;
};

const frameHeaders = { "Content-Security-Policy": IFRAME_CSP };

const routes = new Map<string, Route>([
  ["/", { file: "index.html", type: "text/html" }],
  ["/host.js", { file: "host.js", type: "text/javascript" }],
  ["/frame.html", { file: "frame.html", type: "text/html", headers: frameHeaders }],
  ["/frame.js", { file: "frame.js", type: "text/javascript", headers: frameHeaders }],
]);

const COMPONENT_ROUTE = /^\/components\/([\w-]+)\.js$/;

/** Header that carries a page's session token on `POST /bridge`. */
export const SESSION_HEADER = "x-ajit-session";

const MAX_BRIDGE_BODY = 64 * 1024;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Only answer requests addressed to this machine by name. A page on another
 * site can point its own hostname at 127.0.0.1 (DNS rebinding) and would then
 * be same-origin with us; its requests still carry its own hostname in `Host`.
 */
const isLocalHost = (host: string | undefined) => {
  if (!host) return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
};

const sseEvent = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const reply = (res: ServerResponse, status: number, text: string) => {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
};

/**
 * Reads a request body as text. Resolves to "too large" if it exceeds `limit`
 * bytes, or to undefined if the client goes away first.
 */
const readBody = (req: IncomingMessage, limit: number) =>
  new Promise<string | "too large" | undefined>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Past the limit, keep draining but stop collecting, so the reply still arrives.
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? "too large" : Buffer.concat(chunks).toString("utf8")));
    // `close` follows `end` normally; on its own it means the client went away.
    req.on("error", () => resolve(undefined));
    req.on("close", () => resolve(undefined));
  });

export type PageServer = ReturnType<typeof createPageServer>;

/**
 * Serves the page that shows `sandbox`'s components: the host page, the
 * sandboxed frame, each component's script, `/events` for live updates and
 * bridge responses, and `POST /bridge` for the frame's capability calls.
 *
 * Each `/events` connection is a session with its own bridge. Its first event
 * carries a token, which `POST /bridge` must send back in `SESSION_HEADER`.
 * Closing the connection cancels the session's calls.
 */
export const createPageServer = (sandbox: Sandbox, capabilities: Catalog) => {
  type Session = { res: ServerResponse; bridge: Bridge };
  const sessions = new Map<string, Session>();

  // Tell every page about changes, and stop calls from components that were
  // removed or replaced, whatever their frame does.
  let versions = new Map(sandbox.entries().map((e) => [e.id, e.version]));
  sandbox.onChange(() => {
    const entries = sandbox.entries();
    const current = new Map(entries.map((e) => [e.id, e.version]));
    const stale = [...versions].filter(([id, version]) => current.get(id) !== version).map(([id]) => id);
    versions = current;

    const event = sseEvent("components", entries);
    for (const { res, bridge } of sessions.values()) {
      for (const id of stale) bridge.cancelComponent(id);
      res.write(event);
    }
  });

  const openSession = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const token = randomUUID();
    const bridge = createBridge(capabilities, sandbox.entry, (message) => {
      if (!res.destroyed) res.write(sseEvent("bridge", message));
    });
    sessions.set(token, { res, bridge });
    req.on("close", () => {
      sessions.delete(token);
      bridge.close();
    });
    res.write(sseEvent("session", { token }));
    res.write(sseEvent("components", sandbox.entries()));
  };

  const handleBridge = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.origin !== `http://${req.headers.host}`) return reply(res, 403, "Forbidden");
    const token = req.headers[SESSION_HEADER];
    const session = typeof token === "string" ? sessions.get(token) : undefined;
    if (!session) return reply(res, 401, "Unknown session");

    const body = await readBody(req, MAX_BRIDGE_BODY);
    if (body === undefined) return;
    if (body === "too large") return reply(res, 413, "Payload Too Large");
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return reply(res, 400, "Invalid JSON");
    }
    // Answer now: a stream call only settles when it ends. Responses arrive on
    // the session's event stream. The bridge registers a call before its first
    // await, so a cancel sent after this reply always finds it.
    void session.bridge.handle(message);
    res.writeHead(202);
    res.end();
  };

  const serveComponent = (id: string, res: ServerResponse) => {
    const code = sandbox.code(id);
    if (code === undefined) return reply(res, 404, "Not Found");
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...frameHeaders,
    });
    res.end(code);
  };

  const serveFile = async (route: Route, res: ServerResponse) => {
    try {
      const body = await readFile(new URL(route.file, PAGE_DIR));
      res.writeHead(200, {
        "Content-Type": `${route.type}; charset=utf-8`,
        "X-Content-Type-Options": "nosniff",
        ...route.headers,
      });
      res.end(body);
    } catch (err) {
      console.error(err);
      reply(res, 500, "Internal Server Error");
    }
  };

  const server = createServer(async (req, res) => {
    if (!isLocalHost(req.headers.host)) return reply(res, 403, "Forbidden");
    const { pathname } = new URL(req.url!, "http://localhost");

    if (pathname === "/bridge") {
      return req.method === "POST" ? handleBridge(req, res) : reply(res, 405, "Method Not Allowed");
    }
    if (pathname === "/events") return openSession(req, res);

    const componentId = COMPONENT_ROUTE.exec(pathname)?.[1];
    if (componentId !== undefined) return serveComponent(componentId, res);

    const route = routes.get(pathname);
    if (!route) return reply(res, 404, "Not Found");
    return serveFile(route, res);
  });

  let started: Promise<string> | undefined;

  return {
    server,

    /**
     * Starts listening on `port`, or on a free port if that one is taken, and
     * resolves to the page's URL. Safe to call repeatedly: later calls return
     * the same URL.
     */
    start: (port: number): Promise<string> =>
      (started ??= new Promise<string>((resolve, reject) => {
        const listen = (port: number) => server.listen(port, "localhost");
        server.on("listening", () => {
          const address = server.address();
          resolve(`http://localhost:${typeof address === "object" && address ? address.port : port}`);
        });
        server.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && port !== 0) {
            port = 0;
            listen(port);
          } else {
            reject(err);
          }
        });
        listen(port);
      })),

    /**
     * Stops the server if it was started. Dropping the open event streams
     * closes their sessions, which cancels every call in flight.
     */
    close: async (): Promise<void> => {
      if (!server.listening) {
        return;
      }
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
};
