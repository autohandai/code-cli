/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolCallRequest } from '../../types.js';

export type ResponseCompletionKind =
  | 'tool_call'
  | 'final_answer'
  | 'invalid_deferred_action';

export interface ToolCallCompletion {
  kind: 'tool_call';
}

export interface FinalAnswerCompletion {
  kind: 'final_answer';
}

export interface InvalidDeferredActionCompletion {
  kind: 'invalid_deferred_action';
  reason: 'announced_action_without_tool' | 'blocked_without_tools';
  excerpt: string;
}

export type ResponseCompletionClassification =
  | ToolCallCompletion
  | FinalAnswerCompletion
  | InvalidDeferredActionCompletion;

export interface ResponseCompletionInput {
  response: string;
  toolCalls?: ToolCallRequest[];
}

export interface ResponseCompletionContext {
  response: string;
  toolCalls: readonly ToolCallRequest[];
  normalized: string;
  statements: readonly string[];
}

export type ResponseCompletionHook = (
  context: ResponseCompletionContext
) => ResponseCompletionClassification | undefined;

const ACTION_INTENT_OPENERS = [
  'let me',
  'i ll',
  'i will',
  'i am going to',
  'i m going to',
  'i should',
  'i need to',
  'i ll need to',
  'i will need to',
  'now i ll',
  'now i will',
  'next i ll',
  'next i will',
  'first let me',
] as const;

const ANSWER_INTENT_OPENERS = [
  'let me explain',
  'let me summarize',
  'i can now answer',
  'here is',
  'here s',
] as const;

const OPERATIONAL_ACTIONS = [
  'add',
  'analyze',
  'apply',
  'begin',
  'change',
  'check',
  'create',
  'debug',
  'delete',
  'edit',
  'find',
  'fix',
  'gather',
  'implement',
  'inspect',
  'look at',
  'make',
  'modify',
  'patch',
  'read',
  'refactor',
  'remove',
  'replicate',
  'reproduce',
  'review',
  'run',
  'search',
  'start',
  'trace',
  'update',
  'write',
] as const;

const BLOCKED_WITHOUT_TOOLS_PHRASES = [
  'blocked by no tool',
  'blocked by this turn s no tool',
  'blocked by tool constraint',
  'tools unavailable',
  'no tool constraint',
] as const;

const ANSWER_PROMISE_PHRASES = [
  'let me provide',
  'let me give',
  'i will provide',
  'i ll provide',
  'i can now provide',
  'i can now answer',
] as const;

function normalizeForClassification(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9:/\n -]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitStatements(normalized: string): string[] {
  return normalized
    .split(/\n|[.!?]+/u)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findPhraseIndex(statement: string, phrase: string): number {
  const match = new RegExp(`(?:^|[ :])${escapeRegExp(phrase)}(?:[ :]|$)`).exec(statement);
  if (!match) {
    return -1;
  }

  return match[0].startsWith(' ') || match[0].startsWith(':') ? match.index + 1 : match.index;
}

function hasPhrase(statement: string, phrase: string): boolean {
  return findPhraseIndex(statement, phrase) >= 0;
}

function findOperationalActionIndex(statement: string): number {
  const indexes = OPERATIONAL_ACTIONS
    .map((action) => findPhraseIndex(statement, action))
    .filter((index) => index >= 0);

  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function hasOperationalAction(statement: string): boolean {
  return findOperationalActionIndex(statement) >= 0;
}

function hasActionAnnouncement(statement: string): boolean {
  const actionIndex = findOperationalActionIndex(statement);
  if (actionIndex < 0) {
    return false;
  }

  const answerOpenerIndex = ANSWER_INTENT_OPENERS
    .map((opener) => findPhraseIndex(statement, opener))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (answerOpenerIndex !== undefined && answerOpenerIndex <= actionIndex) {
    return false;
  }

  return ACTION_INTENT_OPENERS.some((opener) => {
    const openerIndex = findPhraseIndex(statement, opener);
    return openerIndex >= 0 && openerIndex <= actionIndex;
  });
}

function isOperationalNextStep(statement: string): boolean {
  if (!hasOperationalAction(statement)) {
    return false;
  }

  return (
    statement.startsWith('next ') ||
    statement.startsWith('next:') ||
    statement.startsWith('status ') ||
    statement.startsWith('status:') ||
    statement.startsWith('blocked ') ||
    statement.startsWith('blocked:')
  );
}

function isAnswerPromiseInsteadOfAnswer(statement: string): boolean {
  const hasPromise = ANSWER_PROMISE_PHRASES.some((phrase) => hasPhrase(statement, phrase));
  if (!hasPromise) {
    return false;
  }

  return (
    hasPhrase(statement, 'to the user') ||
    hasPhrase(statement, 'for the user') ||
    hasPhrase(statement, 'to you') ||
    hasPhrase(statement, 'for you')
  );
}

function getExcerpt(response: string): string {
  return response.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function classifyToolCallCompletion({ toolCalls }: ResponseCompletionContext): ResponseCompletionClassification | undefined {
  if (toolCalls.length > 0) {
    return { kind: 'tool_call' };
  }

  return undefined;
}

function classifyBlockedWithoutTools({ normalized, response }: ResponseCompletionContext): ResponseCompletionClassification | undefined {
  if (BLOCKED_WITHOUT_TOOLS_PHRASES.some((phrase) => hasPhrase(normalized, phrase))) {
    return {
      kind: 'invalid_deferred_action',
      reason: 'blocked_without_tools',
      excerpt: getExcerpt(response),
    };
  }

  return undefined;
}

function classifyAnnouncedActionWithoutTools({
  response,
  statements,
}: ResponseCompletionContext): ResponseCompletionClassification | undefined {
  if (
    statements.some((statement) =>
      hasActionAnnouncement(statement) ||
      isOperationalNextStep(statement) ||
      isAnswerPromiseInsteadOfAnswer(statement)
    )
  ) {
    return {
      kind: 'invalid_deferred_action',
      reason: 'announced_action_without_tool',
      excerpt: getExcerpt(response),
    };
  }

  return undefined;
}

export const DEFAULT_RESPONSE_COMPLETION_HOOKS: readonly ResponseCompletionHook[] = [
  classifyToolCallCompletion,
  classifyBlockedWithoutTools,
  classifyAnnouncedActionWithoutTools,
] as const;

export function classifyResponseCompletion(
  {
    response,
    toolCalls,
  }: ResponseCompletionInput,
  hooks: readonly ResponseCompletionHook[] = DEFAULT_RESPONSE_COMPLETION_HOOKS,
): ResponseCompletionClassification {
  const normalized = normalizeForClassification(response);
  const context: ResponseCompletionContext = {
    response,
    toolCalls: toolCalls ?? [],
    normalized,
    statements: normalized ? splitStatements(normalized) : [],
  };

  for (const hook of hooks) {
    const classification = hook(context);
    if (classification) {
      return classification;
    }
  }

  return { kind: 'final_answer' };
}

export function isDeferredFinalResponse(response: string): boolean {
  return classifyResponseCompletion({ response }).kind === 'invalid_deferred_action';
}
