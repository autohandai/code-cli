/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import chalk from 'chalk';
import fs from 'fs-extra';
import { AUTOHAND_PATHS } from '../constants.js';
import type { SlashCommand, SlashCommandContext } from '../core/slashCommandTypes.js';
import { collectReportEnvironment } from '../feedback/environment.js';
import { resolveGitHubIdentity, type GitHubIdentity } from '../feedback/githubIdentity.js';
import { buildFeedbackTranscript, redactSensitiveText } from '../feedback/sessionTranscript.js';
import { AutoReportClient } from '../reporting/AutoReportClient.js';
import type { ErrorReport, ReportReporter, ReportResponse } from '../reporting/types.js';

const DESCRIPTION = 'report a bug: opens a GitHub issue with your environment and this session attached';

export const metadata: SlashCommand = { command: '/bug', description: DESCRIPTION, implemented: true };
export const aliasMetadata: SlashCommand = { command: '/bug-report', description: DESCRIPTION, implemented: true };

export type BugCommandContext = Partial<Pick<
  SlashCommandContext,
  'config' | 'currentSession' | 'model' | 'provider' | 'workspaceRoot' | 'getInteractionMode' | 'notifyUser'
>> & {
  /** Injectable so tests never shell out to `gh` or `git`. */
  resolveGitHubIdentity?: (options: { cwd?: string }) => Promise<GitHubIdentity | null>;
};

const USAGE = [
  'Usage: /bug <what went wrong>',
  chalk.gray('Opens an issue on github.com/autohandai/code-cli with your environment and GitHub username.'),
  chalk.gray('This session\'s transcript is attached privately. Add --anonymous to leave your username out.'),
].join('\n');

const ANONYMOUS_FLAGS: ReadonlySet<string> = new Set(['--anonymous', '--anon']);
const MIN_DESCRIPTION_CHARS = 10;
const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
// The request uploads the transcript and waits for the issue to be created; it runs in the background.
const SUBMIT_TIMEOUT_MS = 30_000;
const LOCAL_COPY_PATH = path.join(AUTOHAND_PATHS.feedback, 'bug-reports.log');

/**
 * `/bug <description>` files a bug report and returns at once; the issue link
 * arrives through `notifyUser`. Where nobody can be notified later (no
 * composer), it waits for the submission and returns the result.
 */
export async function bug(ctx: BugCommandContext, args: string[] = []): Promise<string | null> {
  const anonymous = args.some((arg) => ANONYMOUS_FLAGS.has(arg));
  const description = args.filter((arg) => !ANONYMOUS_FLAGS.has(arg)).join(' ').trim();
  if (description.length < MIN_DESCRIPTION_CHARS) {
    return USAGE;
  }

  const filing = fileBugReport(ctx, description, anonymous);
  if (!ctx.notifyUser) {
    return filing;
  }

  const notifyUser = ctx.notifyUser;
  void filing.then(notifyUser);
  return chalk.gray('Filing your bug report in the background. The issue link will appear here.');
}

/** Never rejects: the outcome is always a line the user can read. */
async function fileBugReport(ctx: BugCommandContext, description: string, anonymous: boolean): Promise<string> {
  try {
    const identity = anonymous ? null : await lookUpIdentity(ctx);
    const report = buildBugReport(ctx, description, identity, anonymous);
    const client = new AutoReportClient(resolveApiBaseUrl(ctx));
    const response = await client.report(report, { timeoutMs: SUBMIT_TIMEOUT_MS });

    await saveLocalCopy(report, response);
    return describeOutcome(response, identity);
  } catch (error) {
    return chalk.yellow(`Bug report could not be sent (${error instanceof Error ? error.message : String(error)}).`);
  }
}

async function lookUpIdentity(ctx: BugCommandContext): Promise<GitHubIdentity | null> {
  try {
    return await (ctx.resolveGitHubIdentity ?? resolveGitHubIdentity)({ cwd: ctx.workspaceRoot });
  } catch {
    return null;
  }
}

function buildBugReport(
  ctx: BugCommandContext,
  description: string,
  identity: GitHubIdentity | null,
  anonymous: boolean,
): ErrorReport {
  const session = ctx.currentSession;
  const sessionId = session?.metadata.sessionId;
  const messages = session?.getMessages() ?? [];
  const transcript = buildFeedbackTranscript(messages, { sessionId });
  const runtimeError = lastRuntimeError();
  // Anonymous means nothing that names the reporter leaves the machine, public or private.
  const accountId = anonymous ? undefined : ctx.config?.auth?.user?.id;
  const reporter: ReportReporter = {
    ...(identity ? { githubLogin: identity.login, githubSource: identity.source } : {}),
    ...(accountId ? { accountId } : {}),
  };

  return {
    reportKind: 'user',
    errorType: 'user_bug_report',
    errorMessage: redactSensitiveText(description),
    ...(runtimeError ? { sanitizedStack: redactSensitiveText(runtimeError) } : {}),
    ...(ctx.model ? { model: ctx.model } : {}),
    ...(ctx.provider ? { provider: ctx.provider } : {}),
    ...(sessionId ? { sessionId } : {}),
    conversationLength: messages.length,
    lastToolCalls: recentToolNames(messages),
    ...(Object.keys(reporter).length > 0 ? { reporter } : {}),
    environment: collectReportEnvironment({
      provider: ctx.provider,
      model: ctx.model,
      interactionMode: ctx.getInteractionMode?.(),
    }),
    ...(transcript.messages.length > 0 ? { transcript } : {}),
  };
}

function recentToolNames(messages: ReturnType<NonNullable<BugCommandContext['currentSession']>['getMessages']>): string[] {
  return messages
    .filter((message) => message.role === 'tool' && typeof message.name === 'string')
    .slice(-5)
    .map((message) => message.name as string);
}

function lastRuntimeError(): string | null {
  const error = (globalThis as { __autohandLastError?: unknown }).__autohandLastError;
  if (!error) {
    return null;
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function resolveApiBaseUrl(ctx: BugCommandContext): string {
  return process.env.AUTOHAND_API_URL?.trim() || ctx.config?.api?.baseUrl?.trim() || DEFAULT_API_BASE_URL;
}

/** The local log is a delivery backup, not a second copy of the conversation. */
async function saveLocalCopy(report: ErrorReport, response: ReportResponse): Promise<void> {
  try {
    const { transcript, ...rest } = report;
    await fs.ensureFile(LOCAL_COPY_PATH);
    await fs.appendFile(LOCAL_COPY_PATH, `${JSON.stringify({
      ...rest,
      transcript: transcript && { messageCount: transcript.messageCount, truncated: transcript.truncated },
      filedAt: new Date().toISOString(),
      issueUrl: response.issueUrl,
      error: response.error,
    })}\n`, 'utf8');
  } catch {
    // The backup is best effort; the API is the system of record.
  }
}

function describeOutcome(response: ReportResponse, identity: GitHubIdentity | null): string {
  if (!response.success || !response.issueUrl) {
    const reason = response.error ?? 'the issue was not created';
    return chalk.yellow(`Bug report could not be sent (${reason}). A copy is saved in ${LOCAL_COPY_PATH}.`);
  }

  const attribution = identity ? ` as @${identity.login}` : '';
  return response.deduplicated
    ? `${chalk.green('This bug was already reported:')} ${response.issueUrl}`
    : `${chalk.green(`Bug report filed${attribution}:`)} ${response.issueUrl}`;
}
