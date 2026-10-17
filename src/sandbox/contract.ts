import { z } from "zod";
import type { Catalog } from "../capabilities/catalog.js";
import type { Contract, ContractEntry } from "../protocol.js";

/** Contract keys become names in component code, so they must be identifiers. */
export const CONTRACT_KEY = /^[A-Za-z_$][\w$]*$/;

// Parses the shape; `validateContract` then checks it against the capabilities.
// The descriptions are what the model reads in the tool's JSON Schema.

export const ContractEntrySchema = z.strictObject({
  capability: z.string().describe("Name of the capability to use, e.g. \"weather.hourly\"."),
  start: z
    .enum(["mount", "demand"])
    .default("demand")
    .describe("\"mount\": run as soon as the component mounts. \"demand\": run when the component calls run()."),
  keep: z
    .union([z.enum(["latest", "all"]), z.int().positive()])
    .default("latest")
    .describe("How many received values to keep: \"latest\", \"all\", or the last N."),
  input: z
    .unknown()
    .optional()
    .describe("Default input, matching the capability's input schema. run(input) replaces it for that run."),
}) satisfies z.ZodType<ContractEntry>;

export const ContractSchema = z
  .record(z.string().regex(CONTRACT_KEY), ContractEntrySchema)
  .describe("The data the component uses, by key. The component reads each entry with useData(key).") satisfies z.ZodType<Contract>;

/**
 * Checks a parsed contract against the capabilities. Returns one message per
 * problem, or none if the contract is usable:
 * - every capability exists;
 * - inputs match the capability's input schema, and a `mount` entry has all
 *   the input it needs;
 * - only read-only capabilities are used, since nothing yet asks the user to
 *   confirm changes.
 */
export function validateContract(contract: Contract, capabilities: Catalog): string[] {
  const errors: string[] = [];

  for (const [key, entry] of Object.entries(contract)) {
    const capability = capabilities.get(entry.capability);
    if (!capability) {
      errors.push(`${key}: unknown capability "${entry.capability}".`);
      continue;
    }

    if (capability.effect !== "none") {
      errors.push(
        `${key}: "${entry.capability}" is ${capability.effect}. Components can only use read-only capabilities for now.`,
      );
      continue;
    }

    if (!capability.input) {
      if (entry.input !== undefined) errors.push(`${key}: "${entry.capability}" takes no input.`);
      continue;
    }

    // A demand entry may leave its input to run(input); a mount entry runs with what it has.
    if (entry.input === undefined && entry.start === "demand") continue;
    const parsed = capability.input.safeParse(entry.input);
    if (!parsed.success) {
      const what =
        entry.input === undefined
          ? `starts on mount without input, but "${entry.capability}" needs input`
          : `has invalid input for "${entry.capability}"`;
      errors.push(`${key}: ${what}:\n${z.prettifyError(parsed.error)}`);
    }
  }

  return errors;
}
