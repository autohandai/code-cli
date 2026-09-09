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
import { SessionTransferClient } from '../session/transfer/transfer-client.js';
import { captureTransferRepository } from '../session/transfer/transfer-workspace.js';
import { parseSessionTransfer, parseTransferContent, parseTransferReceipt, transferWebUrl, TRANSFER_VERSION, type SessionTransfer, type TransferMessage } from '../session/transfer/session-transfer.js';

export const metadata: SlashCommand = {
  command: '/handoff web',
  description: 'continue this conversation in Autohand Web (--workspace includes repository changes)',
  implemented: true,
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

/** The slash command explicitly requests a private snapshot; local execution stays in this terminal. */
export async function handoffWeb(ctx: HandoffWebContext, args: string[] = []): Promise<string> {
  const usage = 'Usage: /handoff web [--workspace] [--no-open]';
  if (args.includes('--help') || args.some(arg => !['--workspace', '--no-open'].includes(arg))) return usage;
  const token = ctx.config?.auth?.token;
  if (!token) return 'Sign in first with /login, then run /handoff web.';
  const session = ctx.currentSession ?? ctx.sessionManager.getCurrentSession();
  if (!session) return 'No active session to hand off. Start a conversation, then run /handoff web.';

  let url: string;
  let hasRepository = false;
  try {
    const snapshot = conversationSnapshot(session, ctx);
    if (args.includes('--workspace')) {
      snapshot.repository = await (ctx.captureRepository ?? captureTransferRepository)(ctx.workspaceRoot);
      if (!snapshot.repository) return 'No Git repository to transfer. Run /handoff web without --workspace to continue the conversation.';
      hasRepository = true;
    }
    const identity = { token, userId: ctx.config?.auth?.user?.id ?? 'authenticated', accountId: ctx.config?.api?.accountId ?? session.metadata.importedFrom?.accountId };
    const receipt = parseTransferReceipt(await (ctx.client ?? new SessionTransferClient()).upload(parseSessionTransfer(snapshot), identity));
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
  return `Continue in Autohand Web\n${url}\n\nSign in with the same Autohand account. This private transfer expires in 24 hours.\n${hasRepository ? 'Conversation and repository changes included. Review the workspace in Web before continuing.' : 'Conversation included. Add --workspace to also carry repository changes.'}\nYour local session stays available. Local tools and MCP processes continue to run only in the CLI.${browser}`;
}
