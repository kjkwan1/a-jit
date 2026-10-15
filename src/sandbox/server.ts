import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
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

export type PageServer = ReturnType<typeof createPageServer>;

/**
 * Serves the page that shows `sandbox`'s components: the host page, the
 * sandboxed frame, each component's script, and `/events` for live updates.
 */
export const createPageServer = (sandbox: Sandbox) => {
  /**
   * Pages subscribed to `/events`. Each gets the full component list on connect
   * and after every change, so a reconnecting page simply catches up.
   */
  const subscribers = new Set<ServerResponse>();

  const snapshotEvent = () => `event: components\ndata: ${JSON.stringify(sandbox.entries())}\n\n`;

  sandbox.onChange(() => {
    const event = snapshotEvent();
    for (const res of subscribers) res.write(event);
  });

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url!, "http://localhost");

    if (pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.write(snapshotEvent());
      subscribers.add(res);
      req.on("close", () => subscribers.delete(res));
      return;
    }

    const componentId = COMPONENT_ROUTE.exec(pathname)?.[1];
    if (componentId !== undefined) {
      const code = sandbox.code(componentId);
      if (code === undefined) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        ...frameHeaders,
      });
      res.end(code);
      return;
    }

    const route = routes.get(pathname);

    if (!route) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

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
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
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
  };
};
