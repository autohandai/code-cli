/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import open from 'open';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { LoadedConfig, ProviderName } from '../types.js';
import type { Session, SessionManager } from '../session/SessionManager.js';
import { getAssistantChatLogContent } from '../session/chatLog.js';
import { SessionTransferClient, isDivergedOrigin, isOriginRejection, type TransferOrigin } from '../session/transfer/transfer-client.js';
import { captureTransferRepository } from '../session/transfer/transfer-workspace.js';
import { parseSessionTransfer, parseTransferContent, parseTransferReceipt, transferWebUrl, TRANSFER_VERSION, type SessionTransfer, type TransferMessage } from '../session/transfer/session-transfer.js';

export const metadata: SlashCommand = {
  command: '/handoff web',
  description: 'continue this conversation in Autohand Web (--workspace includes repository changes, --new starts a new Web conversation)',
  implemented: true,
};

/** The parent command, so `/handoff` alone offers the surfaces instead of failing. */
export const handoffMetadata: SlashCommand = {
  command: '/handoff',
  description: 'hand this session to Autohand Web or the Autohand Code iOS app',
  implemented: true,
  subcommands: [
    { name: 'web', description: 'continue this conversation in Autohand Web' },
    { name: 'session', description: 'continue this session in the Autohand Code iOS app' },
  ],
};

interface HandoffWebContext {
  sessionManager: SessionManager;
  currentSession?: Session;
  workspaceRoot: string;
  model: string;
  provider?: ProviderName;
  config?: LoadedConfig;
  client?: Pick<SessionTransferClient, 'upload'>;
  openBrowser?: (url: string) => Promise<unknown>;
  captureRepository?: typeof captureTransferRepository;
}

/** Keep user-visible history and embedded images; never copy tools, reasoning, or runtime configuration. */
function conversationSnapshot(session: Session, ctx: HandoffWebContext): SessionTransfer {
  const messages: TransferMessage[] = [];
  for (const message of session.getMessages()) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const names = 'attachmentNames' in message ? message.attachmentNames : undefined;
    const parsed = parseTransferContent(message.content, names);
    const content = message.role === 'assistant' && typeof message.content === 'string'
      ? getAssistantChatLogContent(parsed.content) ?? '' : parsed.content;
    if (!content.trim() && !parsed.images?.length) continue;
    messages.push({ role: message.role, content, createdAt: message.timestamp, ...(parsed.images?.length ? { images: parsed.images } : {}) });
  }
  return parseSessionTransfer({
    version: TRANSFER_VERSION, source: 'cli', sourceSessionId: session.metadata.sessionId,
    title: (session.metadata.summary || messages.find(message => message.role === 'user')?.content || session.metadata.projectName).replace(/\s+/g, ' ').slice(0, 120),
    createdAt: session.metadata.createdAt, provider: ctx.provider ?? ctx.config?.provider ?? 'autohandai',
    model: ctx.model, messages, repository: null,
  });
}

/** Only a session imported from Web can return to its own conversation; `--new` opts out. */
const transferIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function returnOrigin(session: Session, args: string[]): TransferOrigin | undefined {
  if (args.includes('--new')) return undefined;
  const imported = session.metadata.importedFrom;
  if (imported?.source !== 'Autohand Code Web' || !transferIdPattern.test(imported.originalId)) return undefined;
  return { transferId: imported.originalId };
}

/** The slash command explicitly requests a private snapshot; local execution stays in this terminal. */
export async function handoffWeb(ctx: HandoffWebContext, args: string[] = []): Promise<string> {
  const usage = 'Usage: /handoff web [--workspace] [--new] [--no-open]';
  if (args.includes('--help') || args.some(arg => !['--workspace', '--no-open', '--new'].includes(arg))) return usage;
  const token = ctx.config?.auth?.token;
  if (!token) return 'Sign in first with /login, then run /handoff web.';
  const session = ctx.currentSession ?? ctx.sessionManager.getCurrentSession();
  if (!session) return 'No active session to hand off. Start a conversation, then run /handoff web.';

  let url: string;
  let hasRepository = false;
  let resumed: TransferOrigin | undefined;
  let newMessages = 0;
  let downgrade: 'none' | 'unsupported' | 'diverged' = 'none';
  try {
    const snapshot = conversationSnapshot(session, ctx);
    if (args.includes('--workspace')) {
      snapshot.repository = await (ctx.captureRepository ?? captureTransferRepository)(ctx.workspaceRoot);
      if (!snapshot.repository) return 'No Git repository to transfer. Run /handoff web without --workspace to continue the conversation.';
      hasRepository = true;
    }
    const identity = { token, userId: ctx.config?.auth?.user?.id ?? 'authenticated', accountId: ctx.config?.api?.accountId ?? session.metadata.importedFrom?.accountId };
    const origin = returnOrigin(session, args);
    const importedAt = Date.parse(session.metadata.importedFrom?.importedAt ?? '');
    newMessages = origin && Number.isFinite(importedAt) ? snapshot.messages.filter(message => Date.parse(message.createdAt) > importedAt).length : 0;
    const client = ctx.client ?? new SessionTransferClient();
    const value = parseSessionTransfer(snapshot);
    let uploaded;
    try {
      uploaded = await client.upload(value, identity, origin ? { origin } : {});
      resumed = origin;
    } catch (error) {
      // An old Web build rejects `origin`, and a moved conversation rejects the return trip.
      // Both only cost the resume: push the same snapshot again as a new conversation.
      if (!origin || !isOriginRejection(error)) throw error;
      downgrade = isDivergedOrigin(error) ? 'diverged' : 'unsupported';
      uploaded = await client.upload(value, identity);
    }
    const receipt = parseTransferReceipt(uploaded);
    if (identity.accountId && receipt.accountId !== identity.accountId) throw new Error('The transfer account changed. Try again.');
    url = transferWebUrl(receipt);
  } catch (error) {
    return `Could not hand off this session. ${error instanceof Error ? error.message : 'Try again.'}\nYour local conversation is still available.`;
  }

  let browser = '';
  if (!args.includes('--no-open')) {
    try { await (ctx.openBrowser ?? open)(url); }
    catch { browser = '\nOpen the link above to continue; this terminal could not open a browser.'; }
  }
  const resume = resumed ? `This resumes your Web conversation "${session.metadata.summary ?? 'your conversation'}" with ${newMessages} new ${newMessages === 1 ? 'message' : 'messages'}. ` : '';
  const fallback = downgrade === 'diverged'
    ? '\nYour Web conversation moved on since you left, so this opens as a new conversation.'
    : downgrade === 'unsupported' ? '\nYour Web version opens this as a new conversation.' : '';
  return `Continue in Autohand Web\n${url}\n\n${resume}Sign in with the same Autohand account. This private transfer expires in 24 hours.\n${hasRepository ? 'Conversation and repository changes included. Review the workspace in Web before continuing.' : 'Conversation included. Add --workspace to also carry repository changes.'}\nYour local session stays available. Local tools and MCP processes continue to run only in the CLI.${browser}${fallback}`;
}
