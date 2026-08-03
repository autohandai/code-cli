/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { LLMMessage, TurnUsage } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import { getSessionPromptCacheDirective } from './PromptCache.js';
import type { ReactionParser } from './ReactionParser.js';

interface SimpleChatConversation {
  addMessage(message: LLMMessage): void;
  history(): LLMMessage[];
}

export interface SimpleChatAgent {
  isInstructionActive: boolean;
  conversation: SimpleChatConversation;
  llm: LLMProvider;
  totalTokensUsed: number;
  currentTurnActualUsage: TurnUsage;
  currentTurnHadUnavailableUsage: boolean;
  lastAssistantResponseForNotification: string;
  saveUserMessage(content: string): Promise<void>;
  saveAssistantMessage(content: string): Promise<void>;
  getReactionParser(): ReactionParser;
  cleanupModelResponse(content: string): string;
  updateContextUsage(messages: LLMMessage[]): void;
  isPromptCachingEnabled?(): boolean;
  getSessionManager(): {
    getCurrentSession(): { metadata: { sessionId: string } } | null;
  };
}

export function isSimpleChatInstruction(instruction: string): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (normalized.length === 0) return false;

  const casualPatterns = [
    /^(hello|hi|hey|yo|howdy|sup|what'?s up)[!?. ]*$/,
    /^(good\s+(morning|afternoon|evening|night))[!?. ]*$/,
    /^(thanks|thank you|thx|ty)[!?. ]*$/,
    /^(bye|goodbye|see you|later)[!?. ]*$/,
    /^(how are you|how'?s it going)[!?. ]*$/,
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

      const sessionId = this.agent.getSessionManager().getCurrentSession()?.metadata.sessionId;
      const promptCache = this.agent.isPromptCachingEnabled?.() === true
        ? getSessionPromptCacheDirective(sessionId)
        : undefined;
      const completion = await this.agent.llm.complete({
        messages: this.agent.conversation.history(),
        tools: [],
        maxTokens: 1000,
        temperature: 0.7,
        ...(promptCache ? { promptCache } : {}),
      });

      const payload = this.agent.getReactionParser().parseAssistantResponse(completion);
      const rawContent = (payload.finalResponse ?? payload.response ?? completion.content).trim();
      const content = this.agent.cleanupModelResponse(rawContent);
      this.agent.lastAssistantResponseForNotification = content;
      console.log(content);

      this.agent.conversation.addMessage({ role: 'assistant', content: completion.content });
      await this.agent.saveAssistantMessage(completion.content);

      if (completion.usage) {
        this.agent.totalTokensUsed = completion.usage.totalTokens;
        this.agent.currentTurnActualUsage = {
          kind: 'actual',
          promptTokens: completion.usage.promptTokens,
          completionTokens: completion.usage.completionTokens,
          totalTokens: completion.usage.totalTokens,
        };
      } else {
        this.agent.currentTurnHadUnavailableUsage = true;
        this.agent.currentTurnActualUsage = {
          kind: 'unavailable',
          reason: 'not_reported',
        };
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
