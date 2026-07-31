/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import type {
  AuthUser,
  DeviceAuthInitResponse,
  DeviceAuthPollResponse,
} from '../../auth/types.js';

export const BLUEPRINT_SETUP_CONTRACT_VERSION = 1 as const;
export const BLUEPRINT_SETUP_TRAFFIC_CLASS = 'autohand_device_authorization' as const;

export type BlueprintSetupErrorKind =
  | 'profile_violation'
  | 'invalid_params'
  | 'initiation_failed'
  | 'invalid_challenge'
  | 'rate_limited';

export class BlueprintSetupError extends Error {
  constructor(
    public readonly kind: BlueprintSetupErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'BlueprintSetupError';
  }
}

export interface SetupOnlyRuntimeProfile {
  setupOnly: true;
  answerOnly: false;
  clientContext: 'blueprint';
  permissionMode: 'restricted';
  trafficClass: 'autohand_device_authorization';
  toolsEnabled: false;
  hooksEnabled: false;
  mcpEnabled: false;
  memoryEnabled: false;
  telemetryEnabled: false;
  backgroundWorkEnabled: false;
  browserEnabled: false;
  sessionPersistenceEnabled: false;
}

export function createSetupOnlyRuntimeProfile(options: {
  setupOnly?: boolean;
  answerOnly?: boolean;
  restricted?: boolean;
  clientContext?: string;
}): SetupOnlyRuntimeProfile {
  if (options.setupOnly !== true
      || options.answerOnly === true
      || options.restricted !== true
      || options.clientContext !== 'blueprint') {
    throw new BlueprintSetupError(
      'profile_violation',
      'Blueprint setup-only mode requires --setup-only --restricted --client-context blueprint and cannot be combined with --answer-only.',
    );
  }
  return {
    setupOnly: true,
    answerOnly: false,
    clientContext: 'blueprint',
    permissionMode: 'restricted',
    trafficClass: BLUEPRINT_SETUP_TRAFFIC_CLASS,
    toolsEnabled: false,
    hooksEnabled: false,
    mcpEnabled: false,
    memoryEnabled: false,
    telemetryEnabled: false,
    backgroundWorkEnabled: false,
    browserEnabled: false,
    sessionPersistenceEnabled: false,
  };
}

export const blueprintSetupBeginParamsSchema = z.strictObject({
  contractVersion: z.literal(BLUEPRINT_SETUP_CONTRACT_VERSION),
  trafficClass: z.literal(BLUEPRINT_SETUP_TRAFFIC_CLASS),
});

export const blueprintSetupSessionParamsSchema = z.strictObject({
  contractVersion: z.literal(BLUEPRINT_SETUP_CONTRACT_VERSION),
  sessionId: z.string().regex(/^[a-f0-9]{32}$/u),
});

export type BlueprintSetupBeginParams = z.infer<typeof blueprintSetupBeginParamsSchema>;
export type BlueprintSetupSessionParams = z.infer<typeof blueprintSetupSessionParamsSchema>;

export interface BlueprintSetupBeginResult {
  contractVersion: 1;
  sessionId: string;
  userCode: string;
  verificationUriComplete: string;
  expiresAtUnixMs: number;
  pollAfterMs: number;
}

export type BlueprintSetupStatusResult =
  | { contractVersion: 1; status: 'pending'; pollAfterMs: number }
  | { contractVersion: 1; status: 'authorized' }
  | { contractVersion: 1; status: 'expired' }
  | { contractVersion: 1; status: 'cancelled' }
  | {
      contractVersion: 1;
      status: 'failed';
      problem: BlueprintLoginProblem;
    };

export type BlueprintSetupProblemCode =
  | 'adapter_unavailable'
  | 'network_denied'
  | 'initiation_failed'
  | 'invalid_challenge'
  | 'rate_limited'
  | 'poll_failed'
  | 'cancel_failed'
  | 'cleanup_failed'
  | 'credential_persistence_failed'
  | 'protocol_mismatch';

export interface BlueprintLoginProblem {
  code: BlueprintSetupProblemCode;
  message: string;
  retryable: boolean;
}

type BlueprintSetupTerminalResult = Exclude<
  BlueprintSetupStatusResult,
  { status: 'pending' }
>;

export interface BlueprintDeviceAuthClient {
  initiateDeviceAuth(): Promise<DeviceAuthInitResponse>;
  pollDeviceAuth(deviceCode: string): Promise<DeviceAuthPollResponse>;
  cancelDeviceAuth(deviceCode: string): Promise<{ success: boolean; error?: string }>;
}

interface ActiveSetupSession {
  kind: 'active';
  deviceCode: string;
  expiresAtUnixMs: number;
  pollAfterMs: number;
  nextPollAtUnixMs: number;
}

interface TerminalSetupSession {
  kind: 'terminal';
  result: BlueprintSetupTerminalResult;
}

type SetupSession = ActiveSetupSession | TerminalSetupSession;

export interface BlueprintSetupSessionManagerOptions {
  authClient: BlueprintDeviceAuthClient;
  persistCredentials: (token: string, user: AuthUser) => Promise<void>;
  now?: () => number;
  createSessionId?: () => string;
  maxSessions?: number;
}

function validateChallenge(result: DeviceAuthInitResponse): {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  expiresIn: number;
  pollAfterMs: number;
} {
  const expiresIn = result.expiresIn;
  const interval = result.interval;
  if (!result.success
      || typeof result.deviceCode !== 'string'
      || result.deviceCode.length === 0
      || result.deviceCode.length > 512
      || typeof result.userCode !== 'string'
      || !/^[A-Z0-9-]{4,32}$/u.test(result.userCode)
      || typeof result.verificationUriComplete !== 'string'
      || result.verificationUriComplete.length > 2048
      || typeof expiresIn !== 'number'
      || !Number.isInteger(expiresIn)
      || expiresIn < 30
      || expiresIn > 900
      || typeof interval !== 'number'
      || !Number.isInteger(interval)
      || interval < 1
      || interval > 30) {
    throw new BlueprintSetupError(
      result.success ? 'invalid_challenge' : 'initiation_failed',
      result.success
        ? 'Autohand returned an invalid device-authorization challenge.'
        : 'Autohand device authorization could not be initiated.',
    );
  }

  let url: URL;
  try {
    url = new URL(result.verificationUriComplete);
  } catch {
    throw new BlueprintSetupError(
      'invalid_challenge',
      'Autohand returned an invalid device-authorization challenge.',
    );
  }
  const queryKeys = [...new Set(url.searchParams.keys())].sort();
  if (url.protocol !== 'https:'
      || url.origin !== 'https://autohand.ai'
      || url.pathname !== '/signin'
      || url.username
      || url.password
      || url.hash
      || queryKeys.join(',') !== 'continue,user_code'
      || !url.searchParams.get('continue')
      || url.searchParams.get('user_code') !== result.userCode) {
    throw new BlueprintSetupError(
      'invalid_challenge',
      'Autohand returned an invalid device-authorization challenge.',
    );
  }

  return {
    deviceCode: result.deviceCode,
    userCode: result.userCode,
    verificationUriComplete: url.toString(),
    expiresIn,
    pollAfterMs: interval * 1000,
  };
}

function terminal(
  status: 'authorized' | 'expired' | 'cancelled',
): BlueprintSetupTerminalResult {
  return {
    contractVersion: BLUEPRINT_SETUP_CONTRACT_VERSION,
    status,
  };
}

function hasValidAuthorizedCredentials(result: DeviceAuthPollResponse): result is
DeviceAuthPollResponse & { status: 'authorized'; token: string; user: AuthUser } {
  return result.status === 'authorized'
    && typeof result.token === 'string'
    && result.token.length > 0
    && result.token.length <= 16_384
    && typeof result.user?.id === 'string'
    && result.user.id.length > 0
    && typeof result.user.email === 'string'
    && result.user.email.length > 0
    && typeof result.user.name === 'string'
    && result.user.name.length > 0
    && (result.user.avatar === undefined || typeof result.user.avatar === 'string');
}

const LOGIN_PROBLEMS: Record<BlueprintSetupProblemCode, Omit<BlueprintLoginProblem, 'code'>> = {
  adapter_unavailable: {
    message: 'The Autohand authentication adapter is unavailable.',
    retryable: true,
  },
  network_denied: {
    message: 'The setup network policy denied the authorization request.',
    retryable: false,
  },
  initiation_failed: {
    message: 'Autohand device authorization could not be initiated.',
    retryable: true,
  },
  invalid_challenge: {
    message: 'Autohand returned an invalid authorization challenge.',
    retryable: false,
  },
  rate_limited: {
    message: 'Autohand device authorization is temporarily rate limited.',
    retryable: true,
  },
  poll_failed: {
    message: 'Autohand authorization status could not be retrieved.',
    retryable: true,
  },
  cancel_failed: {
    message: 'The Autohand authorization transaction could not be cancelled.',
    retryable: true,
  },
  cleanup_failed: {
    message: 'The Autohand authorization transaction could not be cleaned up.',
    retryable: true,
  },
  credential_persistence_failed: {
    message: 'Autohand credentials could not be saved.',
    retryable: true,
  },
  protocol_mismatch: {
    message: 'The Autohand authorization response did not match setup contract version 1.',
    retryable: false,
  },
};

function failed(code: BlueprintSetupProblemCode): BlueprintSetupTerminalResult {
  return {
    contractVersion: BLUEPRINT_SETUP_CONTRACT_VERSION,
    status: 'failed',
    problem: {
      code,
      ...LOGIN_PROBLEMS[code],
    },
  };
}

export class BlueprintSetupSessionManager {
  private readonly sessions = new Map<string, SetupSession>();
  private readonly now: () => number;
  private readonly createSessionId: () => string;
  private readonly maxSessions: number;

  constructor(private readonly options: BlueprintSetupSessionManagerOptions) {
    this.now = options.now ?? Date.now;
    this.createSessionId = options.createSessionId ?? (() => randomBytes(16).toString('hex'));
    this.maxSessions = options.maxSessions ?? 32;
  }

  async begin(input: unknown): Promise<BlueprintSetupBeginResult> {
    const params = blueprintSetupBeginParamsSchema.safeParse(input);
    if (!params.success) {
      throw new BlueprintSetupError('invalid_params', 'Invalid setup begin parameters.');
    }
    this.removeExpiredSessions();
    if (this.sessions.size >= this.maxSessions) {
      throw new BlueprintSetupError(
        'rate_limited',
        'Too many device-authorization sessions are active.',
      );
    }

    const challenge = validateChallenge(await this.options.authClient.initiateDeviceAuth());
    const sessionId = this.createSessionId();
    if (!/^[a-f0-9]{32}$/u.test(sessionId) || this.sessions.has(sessionId)) {
      throw new BlueprintSetupError(
        'initiation_failed',
        'A secure device-authorization session could not be created.',
      );
    }
    const now = this.now();
    const expiresAtUnixMs = now + challenge.expiresIn * 1000;
    this.sessions.set(sessionId, {
      kind: 'active',
      deviceCode: challenge.deviceCode,
      expiresAtUnixMs,
      pollAfterMs: challenge.pollAfterMs,
      nextPollAtUnixMs: now + challenge.pollAfterMs,
    });

    return {
      contractVersion: BLUEPRINT_SETUP_CONTRACT_VERSION,
      sessionId,
      userCode: challenge.userCode,
      verificationUriComplete: challenge.verificationUriComplete,
      expiresAtUnixMs,
      pollAfterMs: challenge.pollAfterMs,
    };
  }

  async poll(input: unknown): Promise<BlueprintSetupStatusResult> {
    const parsed = blueprintSetupSessionParamsSchema.safeParse(input);
    if (!parsed.success) return failed('protocol_mismatch');
    const session = this.sessions.get(parsed.data.sessionId);
    if (!session) return failed('protocol_mismatch');
    if (session.kind === 'terminal') return session.result;

    const now = this.now();
    if (now >= session.expiresAtUnixMs) {
      const result = terminal('expired');
      this.sessions.set(parsed.data.sessionId, { kind: 'terminal', result });
      return result;
    }
    if (now < session.nextPollAtUnixMs) {
      return {
        contractVersion: BLUEPRINT_SETUP_CONTRACT_VERSION,
        status: 'pending',
        pollAfterMs: Math.max(1000, session.nextPollAtUnixMs - now),
      };
    }

    const apiResult = await this.options.authClient.pollDeviceAuth(session.deviceCode);
    if (!apiResult.success) return failed('poll_failed');
    if (apiResult.status === 'pending') {
      session.nextPollAtUnixMs = now + session.pollAfterMs;
      return {
        contractVersion: BLUEPRINT_SETUP_CONTRACT_VERSION,
        status: 'pending',
        pollAfterMs: session.pollAfterMs,
      };
    }
    if (apiResult.status === 'expired' || apiResult.status === 'cancelled') {
      const result = terminal(apiResult.status);
      this.sessions.set(parsed.data.sessionId, { kind: 'terminal', result });
      return result;
    }
    if (!hasValidAuthorizedCredentials(apiResult)) {
      const result = failed('protocol_mismatch');
      this.sessions.set(parsed.data.sessionId, { kind: 'terminal', result });
      return result;
    }

    try {
      await this.options.persistCredentials(apiResult.token, apiResult.user);
    } catch {
      const result = failed('credential_persistence_failed');
      this.sessions.set(parsed.data.sessionId, { kind: 'terminal', result });
      return result;
    }

    const result = terminal('authorized');
    this.sessions.set(parsed.data.sessionId, { kind: 'terminal', result });
    return result;
  }

  async cancel(input: unknown): Promise<BlueprintSetupStatusResult> {
    const parsed = blueprintSetupSessionParamsSchema.safeParse(input);
    if (!parsed.success) return failed('protocol_mismatch');
    const session = this.sessions.get(parsed.data.sessionId);
    if (!session) return failed('protocol_mismatch');
    if (session.kind === 'terminal') return session.result;

    const result = await this.options.authClient.cancelDeviceAuth(session.deviceCode);
    if (!result.success) {
      const terminalFailure = failed('cancel_failed');
      this.sessions.set(parsed.data.sessionId, { kind: 'terminal', result: terminalFailure });
      return terminalFailure;
    }
    const cancelled = terminal('cancelled');
    this.sessions.set(parsed.data.sessionId, { kind: 'terminal', result: cancelled });
    return cancelled;
  }

  async shutdown(): Promise<void> {
    const cancellations: Promise<unknown>[] = [];
    for (const session of this.sessions.values()) {
      if (session.kind === 'active') {
        cancellations.push(this.options.authClient.cancelDeviceAuth(session.deviceCode));
      }
    }
    this.sessions.clear();
    await Promise.allSettled(cancellations);
  }

  private removeExpiredSessions(): void {
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.kind === 'active' && session.expiresAtUnixMs <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
