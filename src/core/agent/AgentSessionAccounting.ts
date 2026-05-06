import chalk from 'chalk';
import { getAuthClient } from '../../auth/index.js';
import { getProviderConfig, saveConfig } from '../../config.js';
import type { SessionMessage } from '../../session/types.js';
import type {
  AgentOutputEvent,
  AgentRuntime,
  AgentStatusSnapshot,
  LoadedConfig,
  ProviderName,
} from '../../types.js';
import type { PermissionPromptResponse } from '../../permissions/types.js';
import { isExternalCallbackEnabled } from '../../ui/promptCallback.js';
import { formatResumeHint, formatSessionEnding, formatSessionSaved } from '../../ui/theme/startup.js';
import type { ReactionParser } from './ReactionParser.js';

export interface AgentSessionAccountingHost {
  activeProvider: ProviderName;
  confirmationCallback?: (
    message: string,
    context?: { tool?: string; path?: string; command?: string }
  ) => Promise<PermissionPromptResponse>;
  contextPercentLeft: number;
  conversation: { history(): Array<{ role: string; content: unknown }> };
  executedActionNames: string[];
  fileModCount: number;
  filesModifiedThisSession: boolean;
  hookManager: {
    executeHooks(name: string, payload: Record<string, unknown>): Promise<unknown>;
  };
  lastActivityAt: number;
  lastAssistantResponseForNotification: string;
  mcpManager: { disconnectAll(): Promise<unknown> };
  modifiedFilePaths: Set<string>;
  outputListener?: (event: AgentOutputEvent) => void;
  getReactionParser(): ReactionParser;
  persistentInput: { dispose(): void };
  runtime: AgentRuntime;
  sessionManager: {
    getCurrentSession(): {
      append(message: SessionMessage): Promise<void>;
      getMessages(): SessionMessage[];
      metadata: { sessionId: string };
    } | null;
    closeSession(summary: string): Promise<void>;
  };
  sessionStartedAt: number;
  statusListener?: (snapshot: AgentStatusSnapshot) => void;
  telemetryManager: {
    shutdown(): Promise<unknown>;
    syncSession(payload: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      metadata: { workspaceRoot: string };
    }): Promise<unknown>;
    endSession(reason: string): Promise<unknown>;
  };
  totalTokensUsed: number;
  cleanupModelResponse(raw: string): string;
  cleanupUI?(keepInkAlive?: boolean): void;
  closeSession(): Promise<void>;
  emitOutput(event: AgentOutputEvent): void;
  emitStatus(): void;
  getStatusSnapshot(): AgentStatusSnapshot;
}

const CLEANUP_TIMEOUT_MS = 2500;

export async function forceAgentIdleLogout(host: AgentSessionAccountingHost): Promise<void> {
  const idleMinutes = Math.round((Date.now() - host.lastActivityAt) / 60_000);
  console.log();
  console.log(chalk.yellow(`Session idle for ${idleMinutes} minutes \u2014 logging out for security.`));
  console.log(chalk.gray('Run autohand again to start a new session.'));

  if (host.runtime.config.auth?.token) {
    const authClient = getAuthClient();
    try {
      await authClient.logout(host.runtime.config.auth.token);
    } catch {
      // Server logout failed, but we still clear local token.
    }

    const updatedConfig: LoadedConfig = {
      ...host.runtime.config,
      auth: undefined,
    };
    try {
      await saveConfig(updatedConfig);
    } catch {
      // Ignore save errors during idle logout.
    }
  }

  const session = host.sessionManager.getCurrentSession();
  if (session) {
    try {
      await host.sessionManager.closeSession('Idle timeout \u2014 auto logout');
    } catch {
      // Ignore session save errors during forced logout.
    }
  }

  await host.closeSession();
}

export async function closeAgentSession(host: AgentSessionAccountingHost): Promise<void> {
  host.cleanupUI?.(false);
  host.persistentInput.dispose();

  const session = host.sessionManager.getCurrentSession();

  if (!session) {
    console.log(formatSessionEnding());
    await Promise.race([
      Promise.allSettled([
        host.mcpManager.disconnectAll(),
      ]),
      new Promise((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
    ]);
    await host.telemetryManager.shutdown().catch(() => {});
    return;
  }

  const messages = session.getMessages();
  const lastUserMsg = messages.filter((message) => message.role === 'user').slice(-1)[0];
  const summary = lastUserMsg?.content.slice(0, 60) || 'Session complete';
  await host.sessionManager.closeSession(summary);

  console.log(`\n${formatSessionEnding()}\n`);
  console.log(formatSessionSaved(session.metadata.sessionId));
  console.log(`${formatResumeHint(session.metadata.sessionId)}\n`);

  const sessionDuration = Date.now() - host.sessionStartedAt;
  const cleanupTasks = [
    host.mcpManager.disconnectAll(),
    host.hookManager.executeHooks('session-end', {
      sessionId: session.metadata.sessionId,
      sessionEndReason: 'quit',
      duration: sessionDuration,
    }),
    host.telemetryManager.syncSession({
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
      metadata: { workspaceRoot: host.runtime.workspaceRoot },
    }),
    host.telemetryManager.endSession('completed'),
  ];

  await Promise.race([
    Promise.allSettled(cleanupTasks),
    new Promise((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
  ]);

  await host.telemetryManager.shutdown().catch(() => {});
}

export async function saveAgentUserMessage(
  host: AgentSessionAccountingHost,
  content: string
): Promise<void> {
  const session = host.sessionManager.getCurrentSession();
  if (!session) return;

  const message: SessionMessage = {
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  };
  await session.append(message);
}

export async function saveAgentAssistantMessage(
  host: AgentSessionAccountingHost,
  content: string,
  toolCalls?: unknown[]
): Promise<void> {
  const session = host.sessionManager.getCurrentSession();
  if (!session) return;

  const message: SessionMessage = {
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    toolCalls,
  };
  await session.append(message);
}

export function markAgentFilesModified(
  host: AgentSessionAccountingHost,
  filePath?: string,
  changeType?: 'create' | 'modify' | 'delete'
): void {
  host.filesModifiedThisSession = true;
  host.fileModCount++;
  if (filePath) {
    host.modifiedFilePaths.add(filePath);
  }

  if (filePath && host.hookManager) {
    host.hookManager.executeHooks('file-modified', {
      path: filePath,
      changeType: changeType || 'modify',
    }).catch(() => {});
  }

  if (filePath) {
    host.emitOutput({
      type: 'file_modified',
      filePath,
      changeType: changeType || 'modify',
    });
  }
}

export function getAndResetAgentFileModCount(
  host: AgentSessionAccountingHost
): { count: number; paths: string[] } {
  const result = {
    count: host.fileModCount,
    paths: [...host.modifiedFilePaths],
  };
  host.fileModCount = 0;
  host.modifiedFilePaths.clear();
  return result;
}

export function recordAgentExecutedAction(
  host: AgentSessionAccountingHost,
  actionType: string
): void {
  host.executedActionNames.push(actionType);
}

export function getAndResetAgentExecutedActions(
  host: AgentSessionAccountingHost
): string[] {
  const actions = [...host.executedActionNames];
  host.executedActionNames = [];
  return actions;
}

export function getAgentNotificationGuards(host: AgentSessionAccountingHost) {
  return {
    isRpcMode: !!host.runtime.isRpcMode,
    hasConfirmationCallback: !!host.confirmationCallback,
    isAutoConfirm: !!host.runtime.config.ui?.autoConfirm,
    isYesMode: !!host.runtime.options.yes,
    hasExternalCallback: isExternalCallbackEnabled(),
    notificationsConfig: host.runtime.config.ui?.notifications,
  };
}

export function getAgentCompletionNotificationBody(host: AgentSessionAccountingHost): string {
  const direct = normalizeAgentCompletionNotificationBody(
    host,
    host.lastAssistantResponseForNotification
  );
  if (direct) {
    return direct;
  }

  const history = host.conversation.history();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role !== 'assistant' || typeof message.content !== 'string') {
      continue;
    }

    const payload = host.getReactionParser().parseAssistantReactPayload(message.content);
    const candidate = normalizeAgentCompletionNotificationBody(
      host,
      payload.finalResponse ?? payload.response ?? payload.thought ?? message.content
    );
    if (candidate) {
      return candidate;
    }
  }

  return 'Task completed';
}

export function normalizeAgentCompletionNotificationBody(
  host: AgentSessionAccountingHost,
  raw: string
): string {
  const cleaned = host.cleanupModelResponse(raw).replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }
  if (cleaned.length <= 220) {
    return cleaned;
  }
  return `${cleaned.slice(0, 219)}\u2026`;
}

export function setAgentStatusListener(
  host: AgentSessionAccountingHost,
  listener: (snapshot: AgentStatusSnapshot) => void
): void {
  host.statusListener = listener;
  host.emitStatus();
}

export function setAgentOutputListener(
  host: AgentSessionAccountingHost,
  listener: (event: AgentOutputEvent) => void
): void {
  host.outputListener = listener;
}

export function emitAgentOutput(
  host: AgentSessionAccountingHost,
  event: AgentOutputEvent
): void {
  if (host.outputListener) {
    host.outputListener(event);
  }
}

export function emitAgentStatus(host: AgentSessionAccountingHost): void {
  if (host.statusListener) {
    host.statusListener(host.getStatusSnapshot());
  }
}

export function getAgentStatusSnapshot(host: AgentSessionAccountingHost): AgentStatusSnapshot {
  const providerSettings = getProviderConfig(host.runtime.config, host.activeProvider);
  return {
    model: host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured',
    workspace: host.runtime.workspaceRoot,
    contextPercent: host.contextPercentLeft,
    tokensUsed: host.totalTokensUsed,
  };
}
