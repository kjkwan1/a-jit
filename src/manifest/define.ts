import { z } from 'zod';

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

export interface CapabilityNode<K extends Kind, I extends OptionalSchema, O extends OptionalSchema> {
  readonly type: 'capability';
  readonly kind: K;
  readonly description: string;
  readonly input?: I;
  readonly output?: O;
  readonly effect?: EffectType;
  readonly tags: readonly string[];
  readonly binding: BindingFor<K, I, O>;
}

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
): CapabilityNode<'request', I, O> {
  return { ...def, type: 'capability', kind: 'request', tags: def.tags ?? [] };
}

export function stream<O extends Schema, I extends OptionalSchema = undefined>(
  def: Base & {
    input?: I;
    output: O; // required: a stream of void is meaningless
    binding: BindingFor<'stream', I, O>;
  },
): CapabilityNode<'stream', I, O> {
  return { ...def, type: 'capability', kind: 'stream', tags: def.tags ?? [] };
}

export function subscribe<O extends Schema, I extends OptionalSchema = undefined>(
  def: Base & {
    input?: I;
    output: O;
    binding: BindingFor<'subscribe', I, O>;
  },
): CapabilityNode<'subscribe', I, O> {
  return { ...def, type: 'capability', kind: 'subscribe', tags: def.tags ?? [] };
}

// ─── Runtime shape (what the view and dispatcher walk) ───────────────────────

export type RuntimeCapabilityNode = {
  readonly type: 'capability';
  readonly description: string;
  readonly input?: OptionalSchema;
  readonly output?: OptionalSchema;
  readonly effect?: EffectType;
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

export type GroupNode = {
  readonly [key: string]: RuntimeCapabilityNode | GroupNode;
};

export function manifest<const M extends GroupNode>(tree: M): M {
  return tree;
}

