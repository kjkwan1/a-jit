import { z } from "zod";
import { manifest, request, stream, subscribe } from "a-jit";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(id), resolve()), {
      once: true,
    });
  });

const HourlyField = z.enum([
  "temperature",
  "humidity",
  "wind_speed",
  "precipitation_probability",
]);

const HourlyResponse = z.object({
  time: z.array(z.string()),
  temperature: z.array(z.number()).optional(),
  humidity: z.array(z.number()).optional(),
  wind_speed: z.array(z.number()).optional(),
  precipitation_probability: z.array(z.number()).optional(),
});

type HourlyResponse = z.infer<typeof HourlyResponse>;

export const exampleManifest = manifest({
  weather: {
    hourly: request({
      description: "Get hourly weather data",
      effect: "none",
      input: z.object({
        latitude: z.number(),
        longitude: z.number(),
        fields: z.array(HourlyField),
      }),
      output: HourlyResponse,
      binding: async ({ signal }, { latitude, longitude, fields }) => {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", String(latitude));
        url.searchParams.set("longitude", String(longitude));
        url.searchParams.set("timezone", "auto");
        url.searchParams.set("hourly", fields.join(","));

        const response = await fetch(url, { signal });
        if (!response.ok)
          throw new Error(`Open-Meteo responded with ${response.status}`);
        return (await response.json()) as HourlyResponse;
      },
    }),
  },
  homeServer: {
    ping: stream({
      description: "Ping the home server every second",
      output: z.object({ status: z.string() }),
      binding: async function* ({ signal }) {
        while (!signal.aborted) {
          yield { status: "pong" };
          await sleep(1000, signal);
        }
      },
    }),
    messages: subscribe({
      description: "Subscribe to messages from the home server",
      output: z.object({ message: z.string() }),
      binding: ({ emit }) => {
        let count = 0;
        const id = setInterval(
          () => emit({ message: `Message ${++count}` }),
          2000,
        );
        return () => clearInterval(id);
      },
    }),
  },
});

export default exampleManifest;
