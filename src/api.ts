/**
 * API abstraction layer — supports Anthropic and OpenAI-compatible endpoints.
 *
 * Both clients implement the same interface: send a system prompt + messages + tools,
 * get back extracted tool call inputs. No streaming needed (predictions are fire-and-wait).
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { OvernightConfig } from "./types.js";

// ── Shared types ────────────────────────────────────────────────────

/** Provider-agnostic tool definition */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema object
}

/** Result of calling the API with tools */
export interface ToolCallResult {
  name: string;
  input: any;
}

export interface PredictionClient {
  /** Call the API with tools and return all tool call results */
  callWithTools(opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    tools: ToolDef[];
    forceTools?: boolean; // require tool use (default true)
  }): Promise<ToolCallResult[]>;
}

// ── Anthropic client ────────────────────────────────────────────────

class AnthropicClient implements PredictionClient {
  private client: Anthropic;

  constructor(config: OvernightConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey || undefined,
      baseURL: config.baseUrl || undefined,
    });
  }

  async callWithTools(opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    tools: ToolDef[];
    forceTools?: boolean;
  }): Promise<ToolCallResult[]> {
    const anthropicTools: Anthropic.Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      tools: anthropicTools,
      tool_choice: opts.forceTools !== false ? { type: "any" } : undefined,
    });

    return response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ name: b.name, input: b.input }));
  }
}

// ── OpenAI-compatible client ────────────────────────────────────────

class OpenAIClient implements PredictionClient {
  private client: OpenAI;

  constructor(config: OvernightConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || undefined,
      baseURL: config.baseUrl || undefined,
    });
  }

  async callWithTools(opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    tools: ToolDef[];
    forceTools?: boolean;
  }): Promise<ToolCallResult[]> {
    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = opts.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      tools: openaiTools,
      tool_choice: opts.forceTools !== false ? "required" : undefined,
    });

    const toolCalls = response.choices[0]?.message?.tool_calls ?? [];
    return toolCalls
      .filter((tc) => tc.type === "function")
      .map((tc) => {
        let input: any;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }
        return { name: tc.function.name, input };
      });
  }
}

// ── Factory ─────────────────────────────────────────────────────────

export function createClient(config: OvernightConfig): PredictionClient {
  if (config.apiProvider === "openai") {
    return new OpenAIClient(config);
  }
  return new AnthropicClient(config);
}

/** Extract tool call inputs by name from results */
export function extractToolInputs<T>(results: ToolCallResult[], toolName: string): T[] {
  return results.filter((r) => r.name === toolName).map((r) => r.input as T);
}
