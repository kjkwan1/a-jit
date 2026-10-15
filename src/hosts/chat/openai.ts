import OpenAI from "openai";
import type { ChatCompletionFunctionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { executeTool, type Tool } from "../../agent/tool.js";
import { CLI } from "./terminal.js";

export const toOpenAITool = (t: Tool): ChatCompletionFunctionTool => {
  const { $schema, ...parameters } = z.toJSONSchema(t.input, { io: "input", reused: "inline" });
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters },
  };
};

/**
 * Runs a tool call from an OpenAI-style response, where the tool is named and
 * its arguments are a JSON string. Returns the serialized result for the model.
 */
export async function runTool(tools: readonly Tool[], name: string, rawArgs: string): Promise<string> {
  const t = tools.find((t) => t.name === name);
  if (!t) {
    return JSON.stringify({ error: `Unknown tool "${name}". Available tools: ${tools.map((t) => t.name).join(", ")}.` });
  }

  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "Arguments are not valid JSON." });
  }

  const outcome = await executeTool(t, args);
  return JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error });
}

export type ChatConfiguration = {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  tools?: readonly Tool[];
  /** Called after each tool call with the tool's name and the result sent to the model. */
  onToolCall?: (name: string, result: string) => void;
};

/** Stops a model that keeps calling tools from looping forever. */
const MAX_TOOL_TURNS = 20;

export const clientInstance = (baseURL: string, apiKey: string) => {
  const openai = new OpenAI({ baseURL, apiKey });

  return {
    async listModels() {
      const response = await openai.models.list();
      return response.data;
    },
    async echo(model: string, input: string): Promise<boolean> {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: `Echo this back to me: ${input}`,
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      CLI.print(`Echo response: ${content}`);
      // Tolerate quotes, whitespace and short preambles around the echo.
      return content?.includes(input) ?? false;
    },
    async startChat(configuration: ChatConfiguration) {
      const { model, maxTokens, tools = [], onToolCall } = configuration;
      const openAITools = tools.map(toOpenAITool);
      const messages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: configuration.systemPrompt,
        },
      ];

      return {
        /**
         * Sends a user message and runs tool calls until the model answers
         * in plain text, which is returned.
         */
        sendMessage: async (message: string) => {
          messages.push({
            role: "user",
            content: message,
          });

          for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            const response = await openai.chat.completions.create({
              model,
              messages,
              max_tokens: maxTokens,
              ...(openAITools.length ? { tools: openAITools } : {}),
            });

            const reply = response.choices[0]?.message;
            if (!reply) {
              throw new Error("No event received from the agent.");
            }

            const calls = reply.tool_calls ?? [];
            messages.push({
              role: "assistant",
              content: reply.content,
              ...(calls.length ? { tool_calls: calls } : {}),
            });

            if (!calls.length) {
              return reply.content ?? "";
            }

            for (const call of calls) {
              const content =
                call.type === "function"
                  ? await runTool(tools, call.function.name, call.function.arguments)
                  : JSON.stringify({ error: "Only function tools are supported." });
              onToolCall?.(call.type === "function" ? call.function.name : call.custom.name, content);
              messages.push({ role: "tool", tool_call_id: call.id, content });
            }
          }

          throw new Error(`The agent made ${MAX_TOOL_TURNS} rounds of tool calls without replying.`);
        },
      };
    }
  }
}
