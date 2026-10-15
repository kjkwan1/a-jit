import { z } from "zod";

/**
 * A function the agent can call. `input` validates the model's arguments and
 * doubles as the JSON Schema it is shown; `run`'s return value is serialized
 * back to the model as the tool result.
 */
export type Tool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  run: (args: z.output<S>) => unknown;
};

/** Erases the argument type so tools with different schemas fit in one list. */
export const tool = <S extends z.ZodType>(def: Tool<S>): Tool => def as unknown as Tool;

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * Validates `args` and runs the tool. Never throws: invalid arguments and a
 * throwing tool come back as errors so the model can see what went wrong and
 * try again.
 */
export async function executeTool(t: Tool, args: unknown): Promise<ToolOutcome> {
  const parsed = t.input.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: `Invalid arguments:\n${z.prettifyError(parsed.error)}` };
  }
  try {
    return { ok: true, result: (await t.run(parsed.data)) ?? { ok: true } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
