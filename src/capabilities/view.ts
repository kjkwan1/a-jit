import { z } from 'zod';
import type { Capability } from './define.js';
import type { Catalog } from './catalog.js';

// What the model sees of the capabilities: serializable descriptions.

type JsonSchema = Record<string, unknown>;

export type CapabilityView = Pick<Capability, 'kind' | 'description' | 'effect' | 'tags'> & {
  /** What contracts call the capability, e.g. `weather.hourly`. */
  name: string;
  inputSchema?: JsonSchema | undefined;
  outputSchema?: JsonSchema | undefined;
};

/** Throws if a schema has no JSON Schema form, e.g. `z.date()`. The loader reports that as a load error. */
export const toView = (name: string, capability: Capability): CapabilityView => ({
  name,
  kind: capability.kind,
  description: capability.description,
  effect: capability.effect,
  tags: capability.tags,
  inputSchema: capability.input ? z.toJSONSchema(capability.input, { io: 'input', reused: 'inline' }) : undefined,
  outputSchema: capability.output ? z.toJSONSchema(capability.output, { io: 'output', reused: 'inline' }) : undefined,
});

export const toViews = (capabilities: Catalog): CapabilityView[] =>
  [...capabilities].map(([name, capability]) => toView(name, capability));
