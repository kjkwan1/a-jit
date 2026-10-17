import { request } from "a-jit";
import { mock } from "./_mock.js";
import { z } from "zod";

export default request({
  description: "Water the garden",
  effect: "none",
  input: z.object({
    duration: z.number().min(1).max(60).describe("Duration in minutes to water the garden"),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  binding: async ({ signal }, { duration }) => {
    await mock.pause(signal, [1000, 3000]);
    if (signal.aborted) {
      throw new Error("Request aborted");
    }
    return { success: true };
  }
})
