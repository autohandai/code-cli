/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import type {
  AgentAction,
  AssistantReactPayload,
  LLMResponse,
  ToolCallRequest,
} from '../../types.js';

interface ReactionParserOptions {
  cleanupModelResponse?: (content: string) => string;
}

type ParsedRecord = Record<string, unknown>;
const REFLECTION_TOOL_NAME = 'reflection';
const REFLECTION_ARG_FIELDS = ['reflection', 'content', 'text', 'message', 'summary'] as const;

function isRecord(value: unknown): value is ParsedRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asToolArgs(value: unknown): ToolCallRequest['args'] {
  return isRecord(value) ? value as ToolCallRequest['args'] : undefined;
}

function parseToolArgs(value: unknown): ToolCallRequest['args'] {
  if (isRecord(value)) {
    return value as ToolCallRequest['args'];
  }

  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return asToolArgs(parsed);
  } catch {
    return undefined;
  }
}

export class ReactionParser {
  private readonly cleanupModelResponse: (content: string) => string;

  constructor(options: ReactionParserOptions = {}) {
    this.cleanupModelResponse = options.cleanupModelResponse ?? ((content) => content);
  }

  /**
   * Parse LLM response, preferring native tool calls over JSON parsing.
   * This enables reliable function calling when providers support it,
   * while falling back to JSON parsing for providers without native support.
   */
  parseAssistantResponse(completion: LLMResponse): AssistantReactPayload {
    if (completion.toolCalls?.length) {
      let thought: string | undefined;
      let reflection: string | undefined;
      if (completion.content) {
        const trimmed = completion.content.trim();
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed) as ParsedRecord;
            thought = typeof parsed.thought === 'string' ? parsed.thought : undefined;
            reflection = typeof parsed.reflection === 'string' ? parsed.reflection : undefined;
          } catch {
            thought = this.cleanupModelResponse(trimmed) || undefined;
          }
        } else {
          thought = trimmed || undefined;
        }
      }

      return {
        thought,
        ...this.normalizeReflectionToolCalls(completion.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          tool: toolCall.function.name as AgentAction['type'],
          args: this.safeParseToolArgs(toolCall.function.arguments),
        })), reflection),
      };
    }

    const legacyToolCalls = this.extractLegacyToolCalls(completion.content);
    if (legacyToolCalls.length > 0) {
      const textOutside = completion.content
        .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, '')
        .trim();

      const normalized = this.normalizeReflectionToolCalls(legacyToolCalls);
      return {
        thought: textOutside || undefined,
        reflection: normalized.reflection,
        toolCalls: normalized.toolCalls,
      };
    }

    const xmlToolCalls = this.extractXmlToolCalls(completion.content);
    if (xmlToolCalls.length > 0) {
      const textOutside = completion.content
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .trim();

      let reflection: string | undefined;
      if (textOutside.startsWith('{')) {
        try {
          const parsed = JSON.parse(textOutside) as ParsedRecord;
          reflection = typeof parsed.reflection === 'string' ? parsed.reflection : undefined;
        } catch {
          // Surrounding text is not valid JSON; keep it as thought only.
        }
      }

      const normalized = this.normalizeReflectionToolCalls(xmlToolCalls, reflection);
      return {
        thought: textOutside || undefined,
        reflection: normalized.reflection,
        toolCalls: normalized.toolCalls,
      };
    }

    return this.parseAssistantReactPayload(completion.content);
  }

  extractLegacyToolCalls(content: string): ToolCallRequest[] {
    if (!/\[TOOL_CALL\]/i.test(content)) return [];

    const calls: ToolCallRequest[] = [];
    const blockRegex = /\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/gi;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(content)) !== null) {
      const parsed = this.tryParseLegacyToolCall(match[1].trim());
      if (parsed) calls.push(parsed);
    }

    return calls;
  }

  tryParseLegacyToolCall(raw: string): ToolCallRequest | null {
    const jsonParsed = this.tryParseXmlToolCall(raw);
    if (jsonParsed) return jsonParsed;

    const toolMatch = raw.match(/\b(?:tool|name)\s*(?:=>|:)\s*["']([^"']+)["']/i);
    const tool = toolMatch?.[1]?.trim();
    if (!tool) return null;

    const argsSource = this.extractLegacyArgsSource(raw);
    const args = argsSource ? this.parseLegacyArgs(argsSource) : undefined;

    return {
      id: randomUUID(),
      tool: tool as AgentAction['type'],
      args: asToolArgs(args),
    };
  }

  private extractLegacyArgsSource(raw: string): string | undefined {
    const argsMatch = /\b(?:args|arguments)\s*(?:=>|:)\s*\{/i.exec(raw);
    if (!argsMatch) return undefined;

    const openBraceIndex = raw.indexOf('{', argsMatch.index);
    if (openBraceIndex === -1) return undefined;

    let depth = 0;
    let inString: '"' | "'" | undefined;
    let escaped = false;

    for (let i = openBraceIndex; i < raw.length; i += 1) {
      const char = raw[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === inString) {
          inString = undefined;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = char;
        continue;
      }

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return raw.slice(openBraceIndex + 1, i).trim();
        }
      }
    }

    return raw.slice(openBraceIndex + 1).trim();
  }

  private parseLegacyArgs(source: string): ParsedRecord {
    const args: ParsedRecord = {};
    const argPattern = /(?:--)?([A-Za-z_][\w-]*)\s*(?:=>|:|=)?\s*(?:"([^"]*)"|'([^']*)'|(\[[\s\S]*?\]|\{[\s\S]*?\}|true|false|null|-?\d+(?:\.\d+)?))/g;
    let match: RegExpExecArray | null;

    while ((match = argPattern.exec(source)) !== null) {
      const rawKey = match[1];
      const key = this.normalizeLegacyArgKey(rawKey);
      const value = match[2] ?? match[3] ?? match[4] ?? '';
      args[key] = this.parseLegacyArgValue(value);
    }

    return args;
  }

  private normalizeLegacyArgKey(key: string): string {
    return key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
  }

  private parseLegacyArgValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);

    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return value;
  }

  /**
   * Extract tool calls from <tool_call> XML tags in text content.
   */
  extractXmlToolCalls(content: string): ToolCallRequest[] {
    if (!content?.includes('<tool_call>')) return [];

    const calls: ToolCallRequest[] = [];
    const closedRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match: RegExpExecArray | null;

    while ((match = closedRegex.exec(content)) !== null) {
      let inner = match[1].trim();
      const lastTagIdx = inner.lastIndexOf('<tool_call>');
      if (lastTagIdx !== -1) {
        inner = inner.substring(lastTagIdx + '<tool_call>'.length).trim();
      }

      const parsed = this.tryParseXmlToolCall(inner);
      if (parsed) calls.push(parsed);
    }

    if (calls.length === 0) {
      const lastOpen = content.lastIndexOf('<tool_call>');
      if (lastOpen !== -1) {
        const remaining = content.substring(lastOpen + '<tool_call>'.length).trim();
        if (remaining.startsWith('{')) {
          const parsed = this.tryParseXmlToolCall(remaining);
          if (parsed) calls.push(parsed);
        }
      }
    }

    return calls;
  }

  /**
   * Try to parse a single tool call from JSON content extracted from a <tool_call> block.
   */
  tryParseXmlToolCall(json: string): ToolCallRequest | null {
    try {
      const parsed = JSON.parse(json) as ParsedRecord;
      const name = parsed.name ?? parsed.tool;
      if (typeof name !== 'string' || !name.trim()) return null;

      let args: unknown = parsed.arguments ?? parsed.args;
      if (!isRecord(args)) {
        const topLevel: ParsedRecord = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (!['name', 'tool', 'id', 'arguments', 'args'].includes(key)) {
            topLevel[key] = value;
          }
        }
        if (Object.keys(topLevel).length > 0) args = topLevel;
      }

      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          // Keep the original string; asToolArgs will reject it below.
        }
      }

      return {
        id: typeof parsed.id === 'string' ? parsed.id : randomUUID(),
        tool: name as AgentAction['type'],
        args: asToolArgs(args),
      };
    } catch {
      return null;
    }
  }

  safeParseToolArgs(json: string): ToolCallRequest['args'] {
    if (!json || typeof json !== 'string') {
      console.error(chalk.yellow('⚠ Tool arguments empty or not a string'));
      return undefined;
    }

    try {
      const parsed = JSON.parse(json);
      if (isRecord(parsed)) {
        return parsed as ToolCallRequest['args'];
      }
      console.error(chalk.yellow(`⚠ Tool arguments parsed but not an object: ${typeof parsed}`));
      return undefined;
    } catch (err) {
      console.error(chalk.yellow(`⚠ Failed to parse tool arguments: ${err instanceof Error ? err.message : String(err)}`));
      console.error(chalk.gray(`  Raw JSON: ${json.slice(0, 200)}${json.length > 200 ? '...' : ''}`));
      return undefined;
    }
  }

  parseAssistantReactPayload(raw: string): AssistantReactPayload {
    const jsonBlock = this.extractJson(raw);
    if (!jsonBlock) {
      return { finalResponse: raw.trim() };
    }

    try {
      const parsed = JSON.parse(jsonBlock) as ParsedRecord;
      const hasExpectedFields =
        'thought' in parsed ||
        'reflection' in parsed ||
        'toolCalls' in parsed ||
        'finalResponse' in parsed ||
        'response' in parsed;

      if (hasExpectedFields) {
        const inlineToolCall = this.extractSingleToolCall(parsed);
        const toolCalls = this.normalizeToolCalls(parsed.toolCalls);
        if (inlineToolCall && !toolCalls.length) {
          toolCalls.push(inlineToolCall);
        }
        const normalized = this.normalizeReflectionToolCalls(
          toolCalls,
          typeof parsed.reflection === 'string' ? parsed.reflection : undefined
        );
        return {
          thought: typeof parsed.thought === 'string' ? parsed.thought : undefined,
          reflection: normalized.reflection,
          toolCalls: normalized.toolCalls,
          finalResponse:
            (typeof parsed.finalResponse === 'string' ? parsed.finalResponse : undefined) ??
            (typeof parsed.response === 'string' ? parsed.response : undefined),
          response: typeof parsed.response === 'string' ? parsed.response : undefined,
        };
      }

      const singleToolCall = this.extractSingleToolCall(parsed);
      if (singleToolCall) {
        const normalized = this.normalizeReflectionToolCalls(
          [singleToolCall],
          typeof parsed.reflection === 'string' ? parsed.reflection : undefined
        );
        return {
          thought: typeof parsed.thought === 'string' ? parsed.thought : undefined,
          reflection: normalized.reflection,
          toolCalls: normalized.toolCalls,
        };
      }

      const contentValue = this.extractContentFromUnstructuredJson(parsed);
      if (contentValue) {
        return { finalResponse: contentValue };
      }

      return { finalResponse: raw.trim() };
    } catch {
      const thoughtMatch = raw.match(/"thought"\s*:\s*"([^"]+)"/);
      const reflectionMatch = raw.match(/"reflection"\s*:\s*"([^"]+)"/);
      const reflection = reflectionMatch?.[1];
      if (thoughtMatch?.[1]) {
        return {
          thought: thoughtMatch[1],
          reflection,
          finalResponse: thoughtMatch[1],
        };
      }
      if (raw.trim().startsWith('{')) {
        return reflection ? { reflection } : {};
      }
      return { finalResponse: raw.trim() };
    }
  }

  extractContentFromUnstructuredJson(parsed: ParsedRecord): string | undefined {
    const contentFields = ['content', 'text', 'message', 'answer', 'output', 'result', 'reply'];

    for (const field of contentFields) {
      const value = parsed[field];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    if (isRecord(parsed.message)) {
      const content = parsed.message.content;
      if (typeof content === 'string' && content.trim()) {
        return content.trim();
      }
    }

    if (Array.isArray(parsed.choices) && parsed.choices.length > 0) {
      const choice = parsed.choices[0];
      if (isRecord(choice)) {
        if (isRecord(choice.message)) {
          const content = choice.message.content;
          if (typeof content === 'string' && content.trim()) {
            return content.trim();
          }
        }
        if (typeof choice.text === 'string' && choice.text.trim()) {
          return choice.text.trim();
        }
      }
    }

    return undefined;
  }

  normalizeToolCalls(value: unknown): ToolCallRequest[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => this.toToolCall(entry))
      .filter((call): call is ToolCallRequest => Boolean(call));
  }

  normalizeReflectionToolCalls(
    toolCalls: ToolCallRequest[],
    existingReflection?: string
  ): { reflection?: string; toolCalls: ToolCallRequest[] } {
    let reflection = existingReflection?.trim() || undefined;
    const executableToolCalls: ToolCallRequest[] = [];

    for (const toolCall of toolCalls) {
      if (String(toolCall.tool).trim().toLowerCase() !== REFLECTION_TOOL_NAME) {
        executableToolCalls.push(toolCall);
        continue;
      }

      reflection ??= this.extractReflectionToolText(toolCall.args);
    }

    return {
      reflection,
      toolCalls: executableToolCalls,
    };
  }

  private extractReflectionToolText(args: ToolCallRequest['args']): string | undefined {
    if (!isRecord(args)) {
      return undefined;
    }

    for (const field of REFLECTION_ARG_FIELDS) {
      const value = args[field];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return undefined;
  }

  toToolCall(entry: unknown): ToolCallRequest | null {
    if (!isRecord(entry)) {
      return null;
    }

    const toolName = typeof entry.tool === 'string'
      ? entry.tool
      : typeof entry.name === 'string'
        ? entry.name
        : undefined;

    if (!toolName?.trim()) {
      return null;
    }

    let args = parseToolArgs(entry.args) ?? parseToolArgs(entry.arguments);

    if (!args) {
      const topLevelArgs: ParsedRecord = {};
      const reservedKeys = ['tool', 'name', 'id', 'args', 'arguments'];

      for (const [key, value] of Object.entries(entry)) {
        if (!reservedKeys.includes(key) && value !== undefined) {
          topLevelArgs[key] = value;
        }
      }

      if (Object.keys(topLevelArgs).length > 0) {
        args = asToolArgs(topLevelArgs);
      }
    }

    return {
      id: typeof entry.id === 'string' ? entry.id : randomUUID(),
      tool: toolName as AgentAction['type'],
      args: asToolArgs(args),
    };
  }

  extractSingleToolCall(parsed: ParsedRecord): ToolCallRequest | null {
    if (typeof parsed.tool !== 'string' || !parsed.tool.trim()) {
      return null;
    }
    return this.toToolCall(parsed);
  }

  extractJson(raw: string): string | null {
    const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      return fenceMatch[1];
    }
    const braceIndex = raw.indexOf('{');
    if (braceIndex !== -1) {
      return raw.slice(braceIndex);
    }
    return null;
  }
}
