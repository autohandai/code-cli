/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * LLM-powered + static summarization with structured format.
 * Extracted from contextManager.ts for composability.
 */
import type { LLMMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { StructuredSummary } from './types.js';
import { extractMessageMetadata } from './priority.js';
import { serializeMessagesForSummary } from './serializer.js';

/**
 * Create a summary of multiple messages for context preservation (static/fallback version).
 * Fast extraction of files, tools, decisions, errors — no LLM call required.
 */
export function summarizeMessagesStatic(messages: LLMMessage[]): string {
  const files = new Set<string>();
  const tools = new Set<string>();
  const decisions: string[] = [];
  const errors: string[] = [];
  const userRequests: string[] = [];

  for (const msg of messages) {
    const metadata = msg.metadata ?? extractMessageMetadata(msg);

    if (metadata.files) {
      metadata.files.forEach(f => files.add(f));
    }

    if (metadata.tools) {
      metadata.tools.forEach(t => tools.add(t));
    }

    if (msg.role === 'user') {
      const preview = (msg.content ?? '').slice(0, 100);
      userRequests.push(preview + (preview.length < (msg.content?.length ?? 0) ? '...' : ''));
    }

    if (metadata.isDecision && msg.role === 'assistant') {
      const preview = (msg.content ?? '').slice(0, 150);
      decisions.push(preview);
    }

    if (metadata.isError) {
      const preview = (msg.content ?? '').slice(0, 150);
      errors.push(preview);
    }
  }

  const parts: string[] = [
    `[Context Summary - ${messages.length} messages condensed]`,
  ];

  if (userRequests.length > 0) {
    parts.push(`User requests: ${userRequests.slice(0, 3).join(' | ')}`);
  }

  if (files.size > 0) {
    parts.push(`Files touched: ${[...files].slice(0, 10).join(', ')}${files.size > 10 ? ` (+${files.size - 10} more)` : ''}`);
  }

  if (tools.size > 0) {
    parts.push(`Tools used: ${[...tools].join(', ')}`);
  }

  if (decisions.length > 0) {
    parts.push(`Key decisions: ${decisions.slice(0, 2).join(' | ')}`);
  }

  if (errors.length > 0) {
    parts.push(`Errors encountered: ${errors.slice(0, 2).join(' | ')}`);
  }

  return parts.join('\n');
}

/**
 * Summarize messages using the LLM for rich, context-preserving summaries.
 * Falls back to static summarization if LLM is unavailable or fails.
 */
export async function summarizeWithLLM(
  messages: LLMMessage[],
  llm?: LLMProvider,
  memoryManager?: MemoryManager,
): Promise<string> {
  if (!llm || messages.length === 0) {
    return summarizeMessagesStatic(messages);
  }

  try {
    const serializedLog = serializeMessagesForSummary(messages);

    const summarizationPrompt = [
      'Summarize the following conversation for context preservation. Include:',
      '1. The user\'s original request and intent',
      '2. What has been accomplished so far (files created/modified, commands run)',
      '3. What remains to be done',
      '4. Any key decisions or constraints discovered',
      '5. Any user preferences or project-relevant points worth remembering',
      '',
      'Keep it concise (under 500 words). This summary replaces the removed messages.',
      '',
      '--- Conversation ---',
      serializedLog,
    ].join('\n');

    const response = await llm.complete({
      messages: [
        { role: 'system', content: 'You are a context summarization assistant. Produce concise, factual summaries that preserve task continuity.' },
        { role: 'user', content: summarizationPrompt },
      ],
      temperature: 0.1,
      maxTokens: 1000,
    });

    const summaryText = response.content?.trim();
    if (!summaryText) {
      return summarizeMessagesStatic(messages);
    }

    // Persist key facts to memory if MemoryManager is available
    if (memoryManager) {
      await persistKeyFacts(summaryText, memoryManager).catch(() => {
        // Silently ignore memory persistence failures
      });
    }

    return `[LLM Context Summary - ${messages.length} messages condensed]\n${summaryText}`;
  } catch {
    return summarizeMessagesStatic(messages);
  }
}

/**
 * Build a structured summary in pi-mono format from raw summary text and file operations.
 */
export function buildStructuredSummary(
  summaryText: string,
  fileOps: { readFiles: string[]; modifiedFiles: string[] },
): StructuredSummary {
  // Parse the raw summary into structured sections using heuristic extraction
  const lines = summaryText.split('\n').map(l => l.trim()).filter(Boolean);

  const goal = lines.find(l => /goal|intent|request|objective/i.test(l)) ?? lines[0] ?? '';
  const constraints: string[] = [];
  const progress: string[] = [];
  const keyDecisions: string[] = [];
  const nextSteps: string[] = [];
  const criticalContext: string[] = [];

  for (const line of lines) {
    if (/constraint|requirement|must|should/i.test(line)) constraints.push(line);
    else if (/accomplished|done|completed|created|modified|implemented/i.test(line)) progress.push(line);
    else if (/decided|chose|selected|preference/i.test(line)) keyDecisions.push(line);
    else if (/remain|todo|next|pending|still/i.test(line)) nextSteps.push(line);
    else if (/critical|important|essential|key/i.test(line)) criticalContext.push(line);
  }

  return {
    goal,
    constraints,
    progress,
    keyDecisions,
    nextSteps,
    criticalContext,
    readFiles: fileOps.readFiles,
    modifiedFiles: fileOps.modifiedFiles,
  };
}

/**
 * Extract cumulative file operations from a set of messages.
 * Returns read and modified file lists.
 */
export function extractFileOperations(messages: LLMMessage[]): { readFiles: string[]; modifiedFiles: string[] } {
  const readFiles = new Set<string>();
  const modifiedFiles = new Set<string>();

  for (const msg of messages) {
    const metadata = msg.metadata ?? extractMessageMetadata(msg);
    if (!metadata.tools || !metadata.files) continue;

    for (const tool of metadata.tools) {
      const isReadTool = tool.includes('read') || tool.includes('cat') || tool.includes('grep') || tool.includes('search');
      const isWriteTool = tool.includes('write') || tool.includes('edit') || tool.includes('create') || tool.includes('delete') || tool.includes('move');

      if (isReadTool) {
        metadata.files.forEach(f => readFiles.add(f));
      }
      if (isWriteTool) {
        metadata.files.forEach(f => modifiedFiles.add(f));
      }
    }
  }

  return {
    readFiles: [...readFiles],
    modifiedFiles: [...modifiedFiles],
  };
}

/**
 * Extract and persist key facts from a summary to project memory.
 */
export async function persistKeyFacts(summary: string, memoryManager: MemoryManager): Promise<void> {
  const factPatterns = [
    /(?:chose|decided|selected|using|preference|prefer)\s+.{10,100}/gi,
    /(?:constraint|requirement|must|should)\s+.{10,100}/gi,
  ];

  const facts = new Set<string>();
  for (const pattern of factPatterns) {
    let match;
    while ((match = pattern.exec(summary)) !== null) {
      facts.add(match[0].trim());
    }
  }

  for (const fact of [...facts].slice(0, 5)) {
    await memoryManager.store(fact, 'project', ['context-summary'], 'context-summarization');
  }
}

/**
 * Backward-compatible alias for summarizeMessagesStatic.
 * @deprecated Use summarizeMessagesStatic or summarizeWithLLM instead.
 */
export const summarizeMessages = summarizeMessagesStatic;
