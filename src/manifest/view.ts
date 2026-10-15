import { z } from 'zod';
import type { GroupNode, Kind, RuntimeCapabilityNode } from './define.js';

// What the model sees of a manifest: a flat, serializable list of capabilities.

export type ManifestView = {
  capabilities: Record<string, CapabilityView>;
}

type JsonSchema = Record<string, unknown>;

export type CapabilityView = Omit<RuntimeCapabilityNode, 'binding' | 'input' | 'output' | 'type'> & {
  /** Dotted path from the manifest root, e.g. `weather.hourly`. Unique, and accepted by `resolve`. */
  path: string;
  outputFormat: string;
  inputSchema?: JsonSchema | undefined;
  outputSchema?: JsonSchema | undefined;
}

function isCapabilityNode(node: RuntimeCapabilityNode | GroupNode): node is RuntimeCapabilityNode {
  return node.type === 'capability';
}

const PATH_SEPARATOR = '.';

function walk(node: GroupNode, prefix = '', capabilities: CapabilityView[] = []): CapabilityView[] {
  for (const [name, child] of Object.entries(node)) {
    if (name.includes(PATH_SEPARATOR)) {
      throw new Error(`Manifest key "${name}" must not contain "${PATH_SEPARATOR}"`);
    }
    const path = prefix ? `${prefix}${PATH_SEPARATOR}${name}` : name;

    if (isCapabilityNode(child)) {
      const { input, output, binding, type, ...rest } = child;
      capabilities.push({
        path,
        outputFormat: outputFormat(child.kind),
        inputSchema: input ? z.toJSONSchema(input, { io: 'input', reused: 'inline' }) : undefined,
        outputSchema: output ? z.toJSONSchema(output, { io: 'output', reused: 'inline' }) : undefined,
        ...rest,
      });
    } else {
      walk(child, path, capabilities);
    }
  }
  return capabilities;
}

/**
 * Looks up a capability by dotted path. Uses own-property checks so paths like
 * `constructor` or `__proto__` can never resolve to anything on the prototype chain.
 */
export function resolve(root: GroupNode, path: string): RuntimeCapabilityNode | undefined {
  let node: RuntimeCapabilityNode | GroupNode = root;
  for (const segment of path.split(PATH_SEPARATOR)) {
    if (isCapabilityNode(node) || !Object.hasOwn(node, segment)) return undefined;
    node = node[segment]!;
  }
  return isCapabilityNode(node) ? node : undefined;
}

const outputFormat = (kind: Kind) => {
  switch (kind) {
    case 'request':
      return `Promise<Output | undefined>`;
    case 'stream':
      return 'AsyncIterable<Output>';
    case 'subscribe':
      return '(data: Output) => void';
  }
}

export const asView = (manifest: GroupNode): ManifestView => {
  const view = walk(manifest);
  return {
    capabilities: view.reduce((acc, cap) => {
      acc[cap.path] = cap;
      return acc;
    }, {} as Record<string, CapabilityView>)
  }
}

