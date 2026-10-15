import { loadEnvFile } from "node:process";

export type Config = {
  /** OpenAI-compatible endpoint for chat mode, e.g. LM Studio, OpenRouter, Together, Groq. */
  baseURL: string;
  apiKey: string;
  /** Model id for chat mode. When unset, the CLI lists the endpoint's models and asks. */
  model: string | undefined;
  /** Preferred port for the sandbox page. Falls back to a free port if it is taken. */
  port: number;
};

/**
 * Reads `AJIT_*` settings from the environment, after loading `.env` from the
 * working directory if there is one. Variables already set in the environment
 * win over `.env`. Defaults point at a local LM Studio server.
 */
export const loadConfig = (): Config => {
  try {
    loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const port = Number(process.env.AJIT_PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`AJIT_PORT must be a port number, got "${process.env.AJIT_PORT}"`);
  }

  return {
    baseURL: process.env.AJIT_BASE_URL || "http://localhost:1234/v1",
    apiKey: process.env.AJIT_API_KEY || "lm-studio",
    model: process.env.AJIT_MODEL || undefined,
    port,
  };
};
