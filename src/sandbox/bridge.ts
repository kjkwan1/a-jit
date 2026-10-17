import { z } from "zod";
import type { Catalog } from "../capabilities/catalog.js";
import { open } from "../capabilities/dispatch.js";
import type { BridgeRequest, BridgeResponse, ContractEntry } from "../protocol.js";

/**
 * Node-side end of the frame channel: runs contract entries against the
 * capabilities and streams back the results. See `BridgeRequest` and
 * `BridgeResponse` in protocol.ts for the messages.
 *
 * Components address data by contract key, never by capability name, so a
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
  z.object({ type: z.literal("reset") }),
]) satisfies z.ZodType<BridgeRequest>;

/** Finds the `key` entry of `component`'s contract. */
export type ContractLookup = (component: string, key: string) => ContractEntry | undefined;

export type Bridge = ReturnType<typeof createBridge>;

export function createBridge(
  capabilities: Catalog,
  lookup: ContractLookup,
  send: (message: BridgeResponse) => void,
) {
  /** Calls in flight, with the component each belongs to. */
  const calls = new Map<number, { component: string; controller: AbortController }>();

  async function call(id: number, component: string, key: string, input: unknown) {
    const entry = lookup(component, key);
    if (!entry) {
      return send({ type: "error", id, message: `Component "${component}" has no contract entry "${key}".` });
    }
    const capability = capabilities.get(entry.capability);
    if (!capability) {
      return send({ type: "error", id, message: `Unknown capability "${entry.capability}".` });
    }

    const controller = new AbortController();
    const { signal } = controller;
    calls.set(id, { component, controller });
    // A cancelled call goes quiet.
    const post = (message: BridgeResponse) => signal.aborted || send(message);

    try {
      for await (const data of open(capability, input === undefined ? entry.input : input, signal)) {
        post({ type: "next", id, data });
      }
      post({ type: "done", id });
    } catch (err) {
      post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      calls.delete(id);
    }
  }

  /** Cancels every call. */
  const close = () => {
    for (const { controller } of calls.values()) {
      controller.abort();
    }
  };

  return {
    async handle(raw: unknown): Promise<void> {
      const parsed = BridgeRequest.safeParse(raw);
      if (!parsed.success) {
        return;
      }
      const message = parsed.data;
      switch (message.type) {
        case "call":
          return call(message.id, message.component, message.key, message.input);
        case "cancel":
          return calls.get(message.id)?.controller.abort();
        case "reset":
          return close();
      }
    },

    /** Cancels the calls of one component, e.g. when it is removed or replaced. */
    cancelComponent(component: string) {
      for (const call of calls.values()) {
        if (call.component === component) call.controller.abort();
      }
    },

    close,
  };
}
