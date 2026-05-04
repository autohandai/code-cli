/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { AssistantReactPayload, LLMMessage, LLMResponse } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';

interface SimpleChatConversation {
  addMessage(message: LLMMessage): void;
  history(): LLMMessage[];
}

export interface SimpleChatAgent {
  isInstructionActive: boolean;
  conversation: SimpleChatConversation;
  llm: LLMProvider;
  totalTokensUsed: number;
  lastAssistantResponseForNotification: string;
  saveUserMessage(content: string): Promise<void>;
  saveAssistantMessage(content: string): Promise<void>;
  parseAssistantResponse(completion: LLMResponse): AssistantReactPayload;
  cleanupModelResponse(content: string): string;
  updateContextUsage(messages: LLMMessage[]): void;
}

export function isSimpleChatInstruction(instruction: string): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) return false;

  // Keep fast-path scoped to obvious casual chat only.
  // All coding/analysis tasks should go through the full ReAct loop.
  if (normalized.length > 200) return false;
  if (normalized.includes('@')) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.startsWith('!')) return false;

  const codingOrActionKeywords = /\b(file|create|edit|delete|run|fix|implement|refactor|build|test|install|commit|push|read|write|search|find|list|show me|update|add|remove|change|modify|rename|copy|move|execute|deploy|check|analyze|review|debug|inspect|explore|look at|open|save)\b/i;
  if (codingOrActionKeywords.test(normalized)) return false;

  const casualPatterns = [
    /^(hi|hello|hey|yo|sup|hola|bonjour|ola)\b/,
    /^(thanks|thank you|thx|cool|nice|awesome|great|ok|okay)\b/,
    /\b(tell me a joke|another joke|say something funny|make me laugh)\b/,
    /\bwho are you\b/,
    /\bwhat can you do\b/,
    /^good (morning|afternoon|evening)\b/,
  ];

  return casualPatterns.some((pattern) => pattern.test(normalized));
}

export class SimpleChatHandler {
  constructor(private readonly agent: SimpleChatAgent) {}

  isSimpleChat(instruction: string): boolean {
    return isSimpleChatInstruction(instruction);
  }

  async handle(instruction: string): Promise<boolean> {
    this.agent.isInstructionActive = true;

    try {
      this.agent.conversation.addMessage({ role: 'user', content: instruction });
      await this.agent.saveUserMessage(instruction);

      const completion = await this.agent.llm.complete({
        messages: this.agent.conversation.history(),
        tools: [],
        maxTokens: 1000,
        temperature: 0.7,
      });

      const payload = this.agent.parseAssistantResponse(completion);
      const rawContent = (payload.finalResponse ?? payload.response ?? completion.content).trim();
      const content = this.agent.cleanupModelResponse(rawContent);
      this.agent.lastAssistantResponseForNotification = content;
      console.log(content);

      this.agent.conversation.addMessage({ role: 'assistant', content: completion.content });
      await this.agent.saveAssistantMessage(completion.content);

      if (completion.usage) {
        this.agent.totalTokensUsed = completion.usage.totalTokens;
      }

      this.agent.updateContextUsage(this.agent.conversation.history());
      return true;
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      return false;
    } finally {
      this.agent.isInstructionActive = false;
    }
  }
}
