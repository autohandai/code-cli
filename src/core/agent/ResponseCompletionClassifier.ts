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

function findOperationalActionIndex(statement: string): number {
  const indexes = OPERATIONAL_ACTIONS
    .map((action) => statement.indexOf(action))
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
    .map((opener) => statement.indexOf(opener))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (answerOpenerIndex !== undefined && answerOpenerIndex <= actionIndex) {
    return false;
  }

  return ACTION_INTENT_OPENERS.some((opener) => {
    const openerIndex = statement.indexOf(opener);
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
  const hasPromise = ANSWER_PROMISE_PHRASES.some((phrase) => statement.includes(phrase));
  if (!hasPromise) {
    return false;
  }

  return (
    statement.includes(' to the user') ||
    statement.includes(' for the user') ||
    statement.includes(' to you') ||
    statement.includes(' for you')
  );
}

function getExcerpt(response: string): string {
  return response.trim().replace(/\s+/g, ' ').slice(0, 240);
}

export function classifyResponseCompletion({
  response,
  toolCalls,
}: ResponseCompletionInput): ResponseCompletionClassification {
  if ((toolCalls?.length ?? 0) > 0) {
    return { kind: 'tool_call' };
  }

  const normalized = normalizeForClassification(response);
  if (!normalized) {
    return { kind: 'final_answer' };
  }

  if (BLOCKED_WITHOUT_TOOLS_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return {
      kind: 'invalid_deferred_action',
      reason: 'blocked_without_tools',
      excerpt: getExcerpt(response),
    };
  }

  const statements = splitStatements(normalized);
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

  return { kind: 'final_answer' };
}

export function isDeferredFinalResponse(response: string): boolean {
  return classifyResponseCompletion({ response }).kind === 'invalid_deferred_action';
}
