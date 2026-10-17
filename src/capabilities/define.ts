import type { z } from 'zod';

// ─── Core types ──────────────────────────────────────────────────────────────

type Schema = z.ZodType;
type OptionalSchema = Schema | undefined;

export type EffectType = 'none' | 'mutating' | 'destructive';
export type Kind = 'request' | 'stream' | 'subscribe';

export type DispatchOptions = {
  signal: AbortSignal;
};

/** Absent input → no arg. Present → required arg, or optional if the schema accepts undefined. */
type Args<I> = [I] extends [Schema]
  ? undefined extends z.input<I> ? [input?: z.input<I>] : [input: z.input<I>]
  : [];

/** Absent output → void. Present → z.input; the dispatcher parses into z.output. */
type Out<O> = [O] extends [Schema] ? z.input<O> : void;

export type Teardown = () => void | Promise<void>;

/** The binding shape for each kind. */
type BindingFor<K extends Kind, I, O> = {
  request: (opts: DispatchOptions, ...args: Args<I>) => Out<O> | Promise<Out<O>>;
  stream: (opts: DispatchOptions, ...args: Args<I>) => AsyncIterable<Out<O>>;
  subscribe: (
    opts: DispatchOptions & { emit: (event: Out<O>) => void },
    ...args: Args<I>
  ) => Teardown | Promise<Teardown>;
}[K];

/**
 * Marks capability objects. A registered symbol rather than a class, so the
 * loader still recognizes a binding built against another copy of a-jit,
 * e.g. one in the bindings directory's own node_modules.
 */
export const CAPABILITY: unique symbol = Symbol.for('a-jit.capability');

/** A capability as the runtime sees it. The dispatcher validates input and output against the schemas. */
export type Capability = {
  readonly [CAPABILITY]: true;
  readonly description: string;
  readonly input?: OptionalSchema;
  readonly output?: OptionalSchema;
  readonly effect: EffectType;
  readonly tags: readonly string[];
} & (
  | { readonly kind: 'request'; readonly binding: (opts: DispatchOptions, ...args: any[]) => unknown }
  | { readonly kind: 'stream'; readonly binding: (opts: DispatchOptions, ...args: any[]) => AsyncIterable<unknown> }
  | {
      readonly kind: 'subscribe';
      readonly binding: (
        opts: DispatchOptions & { emit: (event: any) => void },
        ...args: any[]
      ) => Teardown | Promise<Teardown>;
    }
);

export const isCapability = (value: unknown): value is Capability =>
  typeof value === 'object' && value !== null && (value as { [CAPABILITY]?: unknown })[CAPABILITY] === true;

type Base = {
  description: string;
  tags?: readonly string[];
};

// ─── Factories ───────────────────────────────────────────────────────────────

export function request<I extends OptionalSchema = undefined, O extends OptionalSchema = undefined>(
  def: Base & {
    input?: I;
    output?: O;
    effect: EffectType; // required: forgetting it must not silently mean 'none'
    binding: BindingFor<'request', I, O>;
  },
): Capability {
  return { ...def, [CAPABILITY]: true, kind: 'request', tags: def.tags ?? [] };
}

/** Streams only read, so their effect is always `none`. */
export function stream<O extends Schema, I extends OptionalSchema = undefined>(
  def: Base & {
    input?: I;
    output: O; // required: a stream of void is meaningless
    binding: BindingFor<'stream', I, O>;
  },
): Capability {
  return { ...def, [CAPABILITY]: true, kind: 'stream', effect: 'none', tags: def.tags ?? [] };
}

/** Subscriptions only read, so their effect is always `none`. */
export function subscribe<O extends Schema, I extends OptionalSchema = undefined>(
  def: Base & {
    input?: I;
    output: O;
    binding: BindingFor<'subscribe', I, O>;
  },
): Capability {
  return { ...def, [CAPABILITY]: true, kind: 'subscribe', effect: 'none', tags: def.tags ?? [] };
}
