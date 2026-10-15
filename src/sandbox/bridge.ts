import { z } from "zod";
import type { GroupNode } from "../manifest/define.js";
import { open } from "../manifest/dispatch.js";
import { resolve } from "../manifest/view.js";
import type { BridgeRequest, BridgeResponse, ContractEntry } from "../protocol.js";

/**
 * Node-side end of the frame channel: runs contract entries against the
 * manifest and streams back the results. See `BridgeRequest` and
 * `BridgeResponse` in protocol.ts for the messages.
 *
 * Components address data by contract key, never by capability path, so a
 * component can only reach what its contract declares.
 */

/** Validates untrusted messages from the page. */
const BridgeRequest = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call"),
    id: z.int(),
    component: z.string(),
    key: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({ type: z.literal("cancel"), id: z.int() }),
]) satisfies z.ZodType<BridgeRequest>;

/** Finds the `key` entry of `component`'s contract. */
export type ContractLookup = (component: string, key: string) => ContractEntry | undefined;

export function createBridge(
  manifest: GroupNode,
  lookup: ContractLookup,
  send: (message: BridgeResponse) => void,
) {
  const calls = new Map<number, AbortController>();

  async function call(id: number, component: string, key: string, input: unknown) {
    const entry = lookup(component, key);
    if (!entry) {
      return send({ type: "error", id, message: `Component "${component}" has no contract entry "${key}".` });
    }
    const node = resolve(manifest, entry.capability);
    if (!node) {
      return send({ type: "error", id, message: `Unknown capability "${entry.capability}".` });
    }

    const controller = new AbortController();
    const { signal } = controller;
    calls.set(id, controller);
    // A cancelled call goes quiet.
    const post = (message: BridgeResponse) => signal.aborted || send(message);

    try {
      for await (const data of open(node, input === undefined ? entry.input : input, signal)) {
        post({ type: "next", id, data });
      }
      post({ type: "done", id });
    } catch (err) {
      post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
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
        await call(message.id, message.component, message.key, message.input);
      }
    },

    close() {
      for (const controller of calls.values()) {
        controller.abort();
      }
    },
  };
}
