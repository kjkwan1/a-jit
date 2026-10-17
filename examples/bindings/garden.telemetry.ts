import { z } from "zod";
import { stream } from "a-jit";
import { mock } from "./_mock.js";

const temperature = mock.walk(30, { chance: 0.2, step: 1, min: -10, max: 50 });
const humidity = mock.walk(50, { chance: 0.2, step: 5, min: 0, max: 100 });

export default stream({
  description: "Get telemetry data from the greenhouse",
  output: z.object({
    temperature: z.number(),
    humidity: z.number(),
    battery_status: z.string(),
  }),
  binding: ({ signal }) =>
    mock.stream(signal, () => ({
      temperature: temperature(),
      humidity: humidity(),
      battery_status: mock.number(0, 1) < 0.9 ? "ok" : "low",
    })),
});
