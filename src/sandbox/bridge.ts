import { z } from "zod";
import { dispatchRequest, dispatchStream, dispatchSubscribe } from "../manifest/dispatch.js";
import type { GroupNode } from "../manifest/define.js";
import { resolve } from "../manifest/view.js";
import type { BridgeRequest, BridgeResponse } from "../protocol.js";

/**
 * Node-side end of the frame channel: runs capability calls against the
 * manifest and forwards the results. See `BridgeRequest` and `BridgeResponse`
 * in protocol.ts for the messages.
 */

/** Validates untrusted messages from the page. */
const BridgeRequest = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call"),
    id: z.int(),
    path: z.string(),
    args: z.unknown().optional(),
  }),
  z.object({ type: z.literal("cancel"), id: z.int() }),
]) satisfies z.ZodType<BridgeRequest>;

export function createBridge(
  manifest: GroupNode,
  send: (message: BridgeResponse) => void,
) {
  const calls = new Map<number, AbortController>();

  async function call(id: number, path: string, args: unknown) {
    const node = resolve(manifest, path);
    if (!node)
      return send({
        type: "error",
        id,
        message: `Unknown capability "${path}"`,
      });

    const controller = new AbortController();
    const { signal } = controller;
    calls.set(id, controller);
    // A cancelled call goes quiet.
    const post = (message: BridgeResponse) => signal.aborted || send(message);

    try {
      switch (node.kind) {
        case "request":
          post({
            type: "result",
            id,
            data: await dispatchRequest(node, args, signal),
          });
          return;
        case "stream":
        case "subscribe": {
          const items =
            node.kind === "stream"
              ? dispatchStream(node, args, signal)
              : dispatchSubscribe(node, args, signal);
          for await (const data of items) {
            post({ type: "next", id, data });
          }
          post({ type: "done", id });
          return;
        }
      }
    } catch (err) {
      post({
        type: "error",
        id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      calls.delete(id);
    }
  }

  return {
    async handle(raw: unknown): Promise<void> {
      const parsed = BridgeRequest.safeParse(raw);
      if (!parsed.success) {
        return;
      }
      const message = parsed.data;
      if (message.type === "cancel") {
        calls.get(message.id)?.abort();
      } else {
        await call(message.id, message.path, message.args);
      }
    },

    close() {
      for (const controller of calls.values()) {
        controller.abort();
      }
    },
  };
}
