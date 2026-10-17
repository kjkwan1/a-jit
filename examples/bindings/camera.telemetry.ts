import { z } from "zod";
import { subscribe } from "a-jit";
import { mock } from "./_mock.js";

export default subscribe({
  description: "Subscribe to camera alerts",
  input: z.object({
    name: z.union([z.literal("backyard"), z.literal("garage")]),
  }),
  output: z.object({
    alert: z.string(),
    timestamp: z.string(),
    entity: z.union([z.literal("person"), z.literal("animal"), z.literal("vehicle")]),
    confidence: z.number(),
  }),
  binding: ({ signal, emit }, { name }) =>
    mock.subscribe(
      signal,
      emit,
      () => ({
        alert: `Motion detected in ${name}`,
        timestamp: new Date().toISOString(),
        entity: mock.pick(["person", "animal"] as const),
        confidence: mock.number(0, 1),
      }),
    ),
});
