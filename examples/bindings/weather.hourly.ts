import { z } from "zod";
import { request } from "a-jit";

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
  wind_speed: z.array(z.number()).optional().describe("km/h"),
  precipitation_probability: z.array(z.number()).optional(),
});

type HourlyResponse = z.infer<typeof HourlyResponse>;

/** Open-Meteo's names for the fields we offer. */
const OPEN_METEO_FIELD: Record<z.infer<typeof HourlyField>, string> = {
  temperature: "temperature_2m",
  humidity: "relative_humidity_2m",
  wind_speed: "wind_speed_10m",
  precipitation_probability: "precipitation_probability",
};

export default request({
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
    url.searchParams.set("hourly", fields.map((f) => OPEN_METEO_FIELD[f]).join(","));

    const response = await fetch(url, { signal });
    if (!response.ok)
      throw new Error(`Open-Meteo responded with ${response.status}`);
    // The series are under `hourly`, keyed by Open-Meteo's names.
    const { hourly } = (await response.json()) as { hourly: Record<string, number[]> & { time: string[] } };
    const result: HourlyResponse = { time: hourly.time };
    for (const field of fields) result[field] = hourly[OPEN_METEO_FIELD[field]];
    return result;
  },
});
