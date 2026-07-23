/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import chalk from 'chalk';
import QRCode from 'qrcode';
import terminalLink from 'terminal-link';
import type { SlashCommand } from '../core/slashCommands.js';
import { getAssistantChatLogContent } from '../session/chatLog.js';
import type { Session, SessionManager } from '../session/SessionManager.js';

const ANSI_BLACK_ON_WHITE = '\u001B[30;47m';
const ANSI_RESET = '\u001B[0m';

export function formatScannableTerminalQRCode(qr: string): string {
  return qr
    .split('\n')
    .map((line) => `${ANSI_BLACK_ON_WHITE}${line}${ANSI_RESET}`)
    .join('\n');
}
import type { LoadedConfig, ProviderName } from '../types.js';
import {
  getMobileApiBaseUrl,
  MobileHandoffClient,
  type MobileHandoffClientLike,
  type MobileImageAttachment,
  type MobilePermissionMode,
  type MobileSessionSnapshot,
  type MobileSessionSnapshotMessage,
} from '../mobile/MobileHandoffClient.js';
import {
  startMobileRelay,
  type MobileClaimedTurnContext,
  type MobilePermissionModeChange,
  type MobileRelayController,
} from '../mobile/MobileRelay.js';

export const metadata: SlashCommand = {
  command: '/go',
  description: 'pair this session with the Autohand Code iOS app',
  implemented: true,
};

export const handoffSessionMetadata: SlashCommand = {
  command: '/handoff session',
  description: 'handoff this session to the Autohand Code iOS app',
  implemented: true,
};

interface GoContext {
  sessionManager: SessionManager;
  currentSession?: Session;
  workspaceRoot: string;
  model: string;
  provider?: ProviderName;
  config?: LoadedConfig;
  client?: MobileHandoffClientLike;
  enqueueInstruction?: (instruction: string) => void;
  enqueueMobileInstruction?: (instruction: string, turn: MobileClaimedTurnContext) => void;
  enqueueInstructionWithImages?: (instruction: string, images: MobileImageAttachment[]) => void;
  enqueueMobileInstructionWithImages?: (
    instruction: string,
    images: MobileImageAttachment[],
    turn: MobileClaimedTurnContext
  ) => void;
  onMobileRelayReady?: (controller: MobileRelayController) => void;
  applyPermissionMode?: (mode: MobilePermissionMode) => MobilePermissionModeChange;
  onMobileConnected?: (message: string) => void;
  onMobileDisconnected?: (message: string) => void;
}

interface HandoffSessionContext extends GoContext {
  isFeatureEnabled?: (key: string, localDefault?: boolean) => boolean;
  trackFeatureActivation?: (key: string, metadata?: Record<string, unknown>) => void | Promise<void>;
}

const MAX_MOBILE_SNAPSHOT_MESSAGES = 24;
const HANDOFF_FLAG = 'experimental_handoff';

type GoMode = 'queue' | 'steer';

function formatUrl(url: string): string {
  return terminalLink.isSupported ? terminalLink(url, url) : chalk.cyan.underline(url);
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function nativeAppUrl(pairingUrl: string): string {
  const url = new URL(pairingUrl);
  const nativeUrl = new URL('autohand-code://go');
  const pairingId = url.searchParams.get('pairing');
  const token = url.searchParams.get('token');

  if (pairingId) nativeUrl.searchParams.set('pairing', pairingId);
  if (token) nativeUrl.searchParams.set('token', token);

  return nativeUrl.toString();
}

function buildMobileSessionSnapshot(session: Session): MobileSessionSnapshot {
  const messages: MobileSessionSnapshotMessage[] = [];

  for (const message of session.getMessages()) {
    if (message.role === 'user') {
      const content = message.content.trim();
      if (content) {
        messages.push({ role: 'user', content, timestamp: message.timestamp });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const content = getAssistantChatLogContent(message.content);
      if (content) {
        messages.push({ role: 'assistant', content, timestamp: message.timestamp });
      }
    }
  }

  const recentMessages = messages.slice(-MAX_MOBILE_SNAPSHOT_MESSAGES);
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const title = firstUserMessage?.content
    ? firstUserMessage.content.replace(/\s+/g, ' ').slice(0, 80)
    : `Continue ${session.metadata.projectName}`;

  return {
    title,
    summary: session.metadata.summary,
    messageCount: session.metadata.messageCount,
    lastActivity: session.metadata.lastActiveAt,
    messages: recentMessages,
  };
}

function parseMode(args: string[], canSteer: boolean): GoMode {
  if (args.includes('--queue')) return 'queue';
  if (args.includes('--steer')) return 'steer';
  return canSteer ? 'steer' : 'queue';
}

export async function go(ctx: GoContext, args: string[] = []): Promise<string | null> {
  const mode = parseMode(args, Boolean(ctx.enqueueInstruction));

  if (mode === 'steer' && !ctx.enqueueInstruction) {
    return [
      chalk.yellow('Steer mode requires an interactive CLI session.'),
      chalk.gray('Run /go --queue to create a durable queue-only handoff from this mode.'),
    ].join('\n');
  }

  const token = ctx.config?.auth?.token;
  if (!token) {
    return [
      chalk.yellow('Sign in first with /login.'),
      chalk.gray('Then run /go again to pair this laptop session with your phone.'),
    ].join('\n');
  }

  const session = ctx.currentSession ?? ctx.sessionManager.getCurrentSession();
  if (!session) {
    return [
      chalk.yellow('No active session to pair.'),
      chalk.gray('Start a conversation, then run /go from the project you want to control remotely.'),
    ].join('\n');
  }

  const client = ctx.client ?? new MobileHandoffClient({
    baseUrl: getMobileApiBaseUrl(ctx.config),
  });

  try {
    const deviceId = await client.getDeviceId();
    await client.registerDevice(token, {
      deviceId,
      clientType: 'cli',
      agentName: `${os.hostname()} Autohand Code`,
      metadata: {
        workspacePath: ctx.workspaceRoot,
        projectName: session.metadata.projectName,
        sessionId: session.metadata.sessionId,
        model: ctx.model,
        provider: ctx.provider,
        platform: process.platform,
        hostname: os.hostname(),
        client: session.metadata.client,
        clientVersion: session.metadata.clientVersion,
      },
    });

    const pairing = await client.createPairing(token, {
      deviceId,
      sessionId: session.metadata.sessionId,
      workspacePath: ctx.workspaceRoot,
      projectName: session.metadata.projectName,
      model: ctx.model,
      provider: ctx.provider,
      capabilities: ['prompt', 'approval', 'notifications'],
      metadata: {
        platform: process.platform,
        hostname: os.hostname(),
        client: session.metadata.client,
        clientVersion: session.metadata.clientVersion,
        sessionSnapshot: JSON.stringify(buildMobileSessionSnapshot(session)),
      },
    });

    if (mode === 'steer' && ctx.enqueueInstruction) {
      const relay = startMobileRelay({
        client,
        token,
        deviceId,
        sessionId: session.metadata.sessionId,
        pairingId: pairing.id,
        mode,
        pollIntervalMs: pairing.pollIntervalMs,
        workspaceRoot: ctx.workspaceRoot,
        keepAwakeByDefault: true,
        enqueueInstruction: ctx.enqueueMobileInstruction ?? ctx.enqueueInstruction,
        enqueueInstructionWithImages: ctx.enqueueMobileInstructionWithImages ?? ctx.enqueueInstructionWithImages,
        onMobileConnected: ctx.onMobileConnected,
        onMobileDisconnected: ctx.onMobileDisconnected,
        applyPermissionMode: ctx.applyPermissionMode,
      });
      ctx.onMobileRelayReady?.(relay);
      void relay.refreshDeliveryStatus();
    }

    const appUrl = nativeAppUrl(pairing.pairingUrl);
    const rawQr = await QRCode.toString(pairing.pairingUrl, {
      type: 'utf8',
      errorCorrectionLevel: 'M',
    });
    // qrcode's UTF-8 renderer assumes a light terminal. Pin both foreground
    // and background so dark themes still display a standards-compliant
    // dark-on-light code that AVFoundation can recognize reliably.
    const qr = formatScannableTerminalQRCode(rawQr);

    return [
      '',
      chalk.bold('Autohand Code mobile handoff'),
      chalk.gray('Scan this with the iOS app to continue this session from your phone.'),
      '',
      qr,
      '',
      `${chalk.gray('Scan or open:')} ${formatUrl(pairing.pairingUrl)}`,
      `${chalk.gray('Simulator fallback:')} ${formatUrl(appUrl)}`,
      `${chalk.gray('Project:')} ${chalk.cyan(session.metadata.projectName)}`,
      `${chalk.gray('Session:')} ${chalk.cyan(session.metadata.sessionId)}`,
      `${chalk.gray('Mode:')} ${mode === 'steer' ? chalk.green('steer live') : chalk.yellow('queue')}`,
      `${chalk.gray('Relay:')} ${mode === 'steer' ? chalk.green('listening for mobile prompts') : chalk.yellow('prompts will wait in the queue')}`,
      `${chalk.gray('Expires:')} ${chalk.cyan(formatExpiry(pairing.expiresAt))}`,
      '',
    ].join('\n');
  } catch (error) {
    return [
      chalk.red('Could not create mobile handoff.'),
      chalk.gray((error as Error).message),
    ].join('\n');
  }
}

export async function handoffSession(ctx: HandoffSessionContext, args: string[] = []): Promise<string | null> {
  const localDefault = ctx.config?.features?.experimentalHandoff === true;
  const enabled = ctx.isFeatureEnabled?.(HANDOFF_FLAG, localDefault) ?? localDefault;
  if (!enabled) {
    return `The /handoff session command is behind ${HANDOFF_FLAG}. Run /features enable ${HANDOFF_FLAG}, then /handoff session again. No restart required.`;
  }

  await ctx.trackFeatureActivation?.(HANDOFF_FLAG, { surface: 'slash_command' });
  return go(ctx, args);
}
