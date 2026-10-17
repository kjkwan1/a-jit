// Shared by the example bindings. The leading "_" keeps the loader from
// treating this file as a capability.

type MockRange = number | readonly [number, number];

type WalkOptions = {
  chance?: number;
  step: number;
  min: number;
  max: number;
};

export const mock = {
  number(min: number, max: number) {
    return min + Math.random() * (max - min);
  },

  pick<const T>(values: readonly T[]): T {
    return values[Math.floor(Math.random() * values.length)]!;
  },

  walk(initial: number, { chance = 1, step, min, max }: WalkOptions) {
    let value = initial;
    return () => {
      if (Math.random() < chance) {
        value += this.number(-step, step);
      }
      value = Math.max(min, Math.min(max, value));
      return value;
    };
  },

  async pause(signal: AbortSignal, range: MockRange = [100, 500]): Promise<boolean> {
    const [min, max] = typeof range === "number" ? [range, range] : range;
    const delay = this.number(min, max);
    if (signal.aborted) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, delay);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    });
  },

  async result<T>(signal: AbortSignal, make: () => T, delay?: MockRange): Promise<T> {
    if (!(await this.pause(signal, delay)) || signal.aborted) {
      throw new Error("Mock operation aborted");
    }
    return make();
  },

  async *stream<T>(
    signal: AbortSignal,
    make: () => T,
    interval: MockRange = [500, 1500],
  ): AsyncGenerator<T> {
    while (!signal.aborted) {
      if (!(await this.pause(signal, interval)) || signal.aborted) {
        return;
      }
      yield make();
    }
  },

  subscribe<T>(
    signal: AbortSignal,
    emit: (value: T) => void,
    make: () => T,
    interval: MockRange = [5000, 15000],
  ) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal.removeEventListener("abort", stop);
    };

    const schedule = () => {
      if (stopped || signal.aborted) {
        return;
      }
      const [min, max] = typeof interval === "number" ? [interval, interval] : interval;
      timer = setTimeout(() => {
        timer = undefined;
        if (stopped || signal.aborted) {
          return;
        }
        emit(make());
        schedule();
      }, this.number(min, max));
    };

    if (signal.aborted) {
      stopped = true;
    } else {
      signal.addEventListener("abort", stop, { once: true });
      schedule();
    }
    return stop;
  },
};
