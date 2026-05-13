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
import type { Session, SessionManager } from '../session/SessionManager.js';
import type { LoadedConfig, ProviderName } from '../types.js';
import {
  getMobileApiBaseUrl,
  MobileHandoffClient,
  type MobileHandoffClientLike,
} from '../mobile/MobileHandoffClient.js';
import { startMobileRelay } from '../mobile/MobileRelay.js';

export const metadata: SlashCommand = {
  command: '/go',
  description: 'pair this session with the Autohand Code iOS app',
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
}

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

export async function go(ctx: GoContext): Promise<string | null> {
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
      },
    });

    if (ctx.enqueueInstruction) {
      startMobileRelay({
        client,
        token,
        deviceId,
        pollIntervalMs: pairing.pollIntervalMs,
        enqueueInstruction: ctx.enqueueInstruction,
      });
    }

    const appUrl = nativeAppUrl(pairing.pairingUrl);
    const qr = await QRCode.toString(pairing.pairingUrl, {
      type: 'utf8',
      errorCorrectionLevel: 'M',
    });

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
      `${chalk.gray('Relay:')} ${ctx.enqueueInstruction ? chalk.green('listening for mobile prompts') : chalk.yellow('pairing only in this mode')}`,
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
