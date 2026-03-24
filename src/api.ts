/**
 * API abstraction layer — supports Anthropic and OpenAI-compatible endpoints.
 *
 * Two call modes:
 * 1. callWithTools() — single-shot, force tool use, return results (profile extraction, etc.)
 * 2. runToolLoop() — multi-turn conversation where the model can call tools (read/forget)
 *    and get results back before making its final output tool call (add_prediction, etc.)
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { OvernightConfig } from "./types.js";

// ── Shared types ────────────────────────────────────────────────────

/** Provider-agnostic tool definition */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

/** Result of calling the API with tools */
export interface ToolCallResult {
  name: string;
  input: any;
}

/** Handler for intermediate tools (read, forget) — returns the tool result string */
export type ToolHandler = (name: string, input: any) => string | Promise<string>;

export interface PredictionClient {
  /** Single-shot: call with tools, force tool use, return results */
  callWithTools(opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    tools: ToolDef[];
    forceTools?: boolean;
  }): Promise<ToolCallResult[]>;

  /** Multi-turn: let the model call intermediate tools (read/forget) and loop
   *  until it calls one of the output tools. Returns only the output tool calls. */
  runToolLoop(opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    tools: ToolDef[];
    outputTools: string[];
    handleTool: ToolHandler;
    maxTurns?: number;
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

  async runToolLoop(opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    tools: ToolDef[];
    outputTools: string[];
    handleTool: ToolHandler;
    maxTurns?: number;
  }): Promise<ToolCallResult[]> {
    const maxTurns = opts.maxTurns ?? 10;
    const anthropicTools: Anthropic.Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: opts.prompt },
    ];

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await this.client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages,
        tools: anthropicTools,
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        // Model responded with text only — no more tool calls
        return [];
      }

      // Check if any are output tools
      const outputCalls = toolUses.filter((t) => opts.outputTools.includes(t.name));
      if (outputCalls.length > 0) {
        return outputCalls.map((b) => ({ name: b.name, input: b.input }));
      }

      // Handle intermediate tools and continue the loop
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const result = await opts.handleTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Add assistant response + tool results to conversation
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }

    return []; // Hit max turns without output
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
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
        return { name: tc.function.name, input };
      });
  }

  async runToolLoop(opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    tools: ToolDef[];
    outputTools: string[];
    handleTool: ToolHandler;
    maxTurns?: number;
  }): Promise<ToolCallResult[]> {
    const maxTurns = opts.maxTurns ?? 10;
    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = opts.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ];

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await this.client.chat.completions.create({
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages,
        tools: openaiTools,
      });

      const choice = response.choices[0];
      if (!choice?.message?.tool_calls?.length) return [];

      const toolCalls = choice.message.tool_calls;
      const outputCalls = toolCalls.filter((tc) =>
        opts.outputTools.includes(tc.function.name),
      );

      if (outputCalls.length > 0) {
        return outputCalls.map((tc) => {
          let input: any;
          try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
          return { name: tc.function.name, input };
        });
      }

      // Add assistant message with tool calls
      messages.push(choice.message as any);

      // Handle intermediate tools
      for (const tc of toolCalls) {
        let input: any;
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
        const result = await opts.handleTool(tc.function.name, input);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    return [];
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
