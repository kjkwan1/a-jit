import { z } from "zod";
import { stream } from "a-jit";
import { mock } from "./_mock.js";

const cpu = mock.walk(50, { chance: 0.3, step: 5, min: 0, max: 100 });
const memory = mock.walk(60, { chance: 0.2, step: 3, min: 0, max: 100 });
const disk = mock.walk(70, { chance: 0.1, step: 2, min: 0, max: 100 });

export default stream({
  description: "Get telemetry data from the NAS",
  output: z.object({
    cpu_usage: z.number(),
    memory_usage: z.number(),
    disk_usage: z.number(),
  }),
  binding: ({ signal }) =>
    mock.stream(signal, () => ({
      cpu_usage: cpu(),
      memory_usage: memory(),
      disk_usage: disk(),
    })),
});
