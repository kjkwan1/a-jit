import { z } from "zod";
import { request } from "a-jit";
import { mock } from "./_mock.js";

export default request({
  description: "Activate PA system with input text",
  effect: 'none',
  input: z.object({
    text: z.string().describe("Words you'd like to blare through the PA system"),
    volume: z.number().min(0).max(100).describe("Volume level from 0 to 100"),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  binding: async ({ signal }, { text, volume }) => {
    await mock.pause(signal, [500, 1500]);
    if (signal.aborted) {
      throw new Error("Request aborted");
    }
    return { success: true };
  }
});
