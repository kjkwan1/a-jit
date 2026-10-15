import { buildSystemPrompt } from "../../agent/prompt.js";
import { componentTools } from "../../agent/tools.js";
import type { Config } from "../../config.js";
import type { GroupNode } from "../../manifest/define.js";
import { asView } from "../../manifest/view.js";
import { createSandbox } from "../../sandbox/sandbox.js";
import { createPageServer } from "../../sandbox/server.js";
import { clientInstance } from "./openai.js";
import { CLI } from "./terminal.js";

/** Picks the model from config, or asks the user to choose from the endpoint's list. */
const chooseModel = async (instance: ReturnType<typeof clientInstance>, configured: string | undefined) => {
  if (configured) return configured;

  const models = await instance.listModels();
  CLI.print(`Found ${models.length} models:`);
  const selected = await CLI.select(
    "Select a model to use:",
    models.map((m) => m.id),
    "gpt-4o",
  );
  return models.some((m) => m.id === selected) ? selected : undefined;
};

/** Converses with an OpenAI-compatible model in the terminal. A dev harness next to MCP mode. */
export const runChat = async (manifest: GroupNode, config: Config) => {
  CLI.print("Welcome to A-JIT!");
  const instance = clientInstance(config.baseURL, config.apiKey);
  CLI.print(`Endpoint: ${config.baseURL}`);

  const model = await chooseModel(instance, config.model);
  if (!model) {
    CLI.print("No model selected. Exiting.");
    return;
  }

  const text = "Hello, world!";
  CLI.print(`Checking ${model} by echoing: "${text}"`);
  if (!(await instance.echo(model, text))) {
    CLI.print(`Model ${model} failed to echo back the input. Exiting.`);
    return;
  }

  const view = asView(manifest);
  CLI.print(`Manifest view: ${JSON.stringify(view, null, 2)}`);
  const sandbox = createSandbox();
  CLI.print(`Components are shown at ${await createPageServer(sandbox, manifest).start(config.port)}`);

  const { sendMessage } = await instance.startChat({
    model,
    systemPrompt: buildSystemPrompt(view),
    maxTokens: 96000,
    tools: componentTools(sandbox, manifest),
    onToolCall: (name, result) => CLI.print(`[${name}] ${result.length > 200 ? `${result.slice(0, 200)}…` : result}`),
  });

  while (true) {
    const message = await CLI.message("You: ");
    if (message.trim().toLowerCase() === "exit") {
      CLI.print("Exiting.");
      // The sandbox server would otherwise keep the process alive.
      process.exit(0);
    }
    const response = await sendMessage(message);
    CLI.print(`Assistant: ${response}`);
  }
};
