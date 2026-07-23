/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { formatScannableTerminalQRCode, go, handoffSession } from '../../src/commands/go.js';
import { stopMobileRelay } from '../../src/mobile/MobileRelay.js';
import type { MobileHandoffClientLike } from '../../src/mobile/MobileHandoffClient.js';
import type { Session, SessionManager } from '../../src/session/SessionManager.js';

const mobileTerminalReporterConstructed = vi.hoisted(() => vi.fn());
const mobileTerminalReport = vi.hoisted(() => vi.fn(async () => undefined));
const mobileTerminalFlush = vi.hoisted(() => vi.fn(async () => undefined));
const validateAuthSession = vi.hoisted(() => vi.fn());

vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: () => ({ validateSession: validateAuthSession }),
}));

vi.mock('../../src/mobile/MobileTerminalReporter.js', () => ({
  MobileTerminalReporter: class MobileTerminalReporterMock {
    constructor(options: unknown) {
      mobileTerminalReporterConstructed(options);
    }

    report = mobileTerminalReport;
    flush = mobileTerminalFlush;
  },
}));

vi.mock('qrcode', () => ({
  default: {
    toString: vi.fn().mockResolvedValue('QR-CODE'),
  },
}));

function createSession(): Session {
  return {
    metadata: {
      sessionId: 'session-1',
      createdAt: '2026-05-13T00:00:00.000Z',
      lastActiveAt: '2026-05-13T00:00:00.000Z',
      projectPath: '/Users/test/project',
      projectName: 'project',
      model: 'gpt-5.3-codex',
      messageCount: 1,
      status: 'active',
      client: 'terminal',
    },
    getMessages: vi.fn().mockReturnValue([
      { role: 'user', content: 'Investigate mobile handoff', timestamp: '2026-05-13T00:00:01.000Z' },
      { role: 'assistant', content: 'I found the pairing route.', timestamp: '2026-05-13T00:00:02.000Z' },
    ]),
  } as Session;
}

function createSessionManager(session: Session | null): SessionManager {
  return {
    getCurrentSession: vi.fn().mockReturnValue(session),
  } as unknown as SessionManager;
}

describe('/go command', () => {
  beforeEach(() => {
    mobileTerminalReporterConstructed.mockClear();
    mobileTerminalReport.mockClear();
    mobileTerminalFlush.mockClear();
    validateAuthSession.mockReset();
    validateAuthSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'verified-user-1', email: 'user@example.com', name: 'User' },
    });
  });

  it('pins QR contrast to dark modules on a light terminal field', () => {
    const formatted = formatScannableTerminalQRCode('QR\nCODE');

    expect(formatted).toBe('\u001B[30;47mQR\u001B[0m\n\u001B[30;47mCODE\u001B[0m');
    expect(stripAnsi(formatted)).toBe('QR\nCODE');
  });

  it('asks the user to log in before pairing', async () => {
    const result = await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      config: { configPath: '/tmp/config.json' },
    });

    expect(stripAnsi(result || '')).toContain('Sign in first with /login.');
  });

  it('requires an active session', async () => {
    const result = await go({
      sessionManager: createSessionManager(null),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'token', user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
      },
    });

    expect(stripAnsi(result || '')).toContain('No active session to pair.');
  });

  it('creates a mobile handoff and renders the returned QR link', async () => {
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-1',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-1&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValue(null),
    };

    const result = await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'token', user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
      },
      client,
    });

    const output = stripAnsi(result || '');
    expect(output).toContain('Autohand Code mobile handoff');
    expect(output).toContain('QR-CODE');
    expect(output).toContain('autohand-code://go?pairing=pairing-1&token=secret');
    expect(output).toContain('https://autohand.ai/code/go?pairing=pairing-1&token=secret');
    expect(output).toContain('Mode: queue');
    expect(output).toContain('Relay: prompts will wait in the queue');
    expect(client.registerDevice).toHaveBeenCalledWith('token', expect.objectContaining({
      deviceId: 'device-1',
      clientType: 'cli',
      agentName: expect.stringContaining('Autohand Code'),
      metadata: expect.objectContaining({
        sessionId: 'session-1',
        workspacePath: '/Users/test/project',
      }),
    }));
    expect(client.createPairing).toHaveBeenCalledWith('token', expect.objectContaining({
      deviceId: 'device-1',
      sessionId: 'session-1',
      workspacePath: '/Users/test/project',
      projectName: 'project',
      capabilities: ['prompt', 'approval', 'notifications'],
      metadata: expect.objectContaining({
        sessionSnapshot: expect.any(String),
      }),
    }));
    const payload = (client.createPairing as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const snapshot = JSON.parse(String(payload.metadata?.sessionSnapshot));
    expect(snapshot.title).toBe('Investigate mobile handoff');
    expect(snapshot.messages).toEqual([
      { role: 'user', content: 'Investigate mobile handoff', timestamp: '2026-05-13T00:00:01.000Z' },
      { role: 'assistant', content: 'I found the pairing route.', timestamp: '2026-05-13T00:00:02.000Z' },
    ]);
  });

  it('starts a relay listener when the interactive queue is available', async () => {
    const onMobileConnected = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      publishMobileEvent: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-1',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-1&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn()
        .mockResolvedValueOnce({
          id: 'work-1',
          repo: 'project',
          branch: 'main',
          prompt: 'hello from iPhone',
          priority: 0,
          status: 'running',
          agentId: null,
          deviceId: 'device-1',
          payload: {
            deliveryMode: 'steer',
            sessionId: 'session-1',
            pairingId: 'pairing-1',
            approvalMode: 'restricted',
          },
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:01.000Z',
        })
        .mockResolvedValue(null),
    };
    const enqueueInstruction = vi.fn();
    const applyPermissionMode = vi.fn().mockReturnValue({
      previousMode: 'interactive',
      appliedMode: 'restricted',
      rollbackIfCurrent: vi.fn().mockReturnValue(true),
    });

    const result = await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'token', user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
      },
      client,
      enqueueInstruction,
      applyPermissionMode,
      onMobileConnected,
    });

    await vi.waitFor(() => expect(enqueueInstruction).toHaveBeenCalledOnce());

    expect(stripAnsi(result || '')).toContain('Relay: listening for mobile prompts');
    expect(client.sendRelayHeartbeat).toHaveBeenCalledWith('token', {
      sessionId: 'session-1',
      deviceId: 'device-1',
      pairingId: 'pairing-1',
      mode: 'steer',
    });
    expect(client.claimWork).toHaveBeenCalledWith('token', 'device-1', {
      deliveryMode: 'steer',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
    });
    expect(enqueueInstruction).toHaveBeenCalledWith(
      'hello from iPhone',
      expect.objectContaining({
        turn: expect.objectContaining({ workId: 'work-1' }),
        relay: expect.any(Object),
      }),
    );
    expect(applyPermissionMode).toHaveBeenCalledWith('restricted');
    expect(onMobileConnected).toHaveBeenCalledOnce();
    expect(onMobileConnected).toHaveBeenCalledWith(
      'Mobile connected. Live prompts will run in this CLI session.'
    );
    stopMobileRelay();
  });

  it('keeps a token-only login durable using the registration owner', async () => {
    let relay: Parameters<NonNullable<Parameters<typeof go>[0]['onMobileRelayReady']>>[0] | undefined;
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('shared-device-1'),
      registerDevice: vi.fn().mockResolvedValue({
        profile: { id: 'verified-user-1' },
        account: { id: 'verified-account-1' },
      }),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-token-only',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-token-only&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'shared-device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValue(null),
      updateWork: vi.fn().mockResolvedValue({}),
      publishMobileEvent: vi.fn().mockResolvedValue(undefined),
    };

    await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'token-without-profile' },
      },
      client,
      enqueueInstruction: vi.fn(),
      onMobileRelayReady: (controller) => { relay = controller; },
    });

    expect(validateAuthSession).not.toHaveBeenCalled();
    expect(mobileTerminalReporterConstructed).toHaveBeenCalledWith(expect.objectContaining({
      owner: {
        profileId: 'verified-user-1',
        accountId: 'verified-account-1',
      },
    }));
    await relay!.finishClaimedTurn({
      workId: 'work-token-only',
      prompt: 'safe prompt',
      startedAt: '2026-05-13T00:00:00.000Z',
    }, { status: 'completed', output: 'done' });
    expect(mobileTerminalReport).toHaveBeenCalledWith(expect.objectContaining({
      workId: 'work-token-only',
      status: 'completed',
    }));
    expect(client.updateWork).not.toHaveBeenCalled();
    stopMobileRelay();
  });

  it('uses the same-API registration identity when the separate auth endpoint is unavailable', async () => {
    validateAuthSession.mockRejectedValueOnce(new Error('auth endpoint unavailable'));
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('same-api-device-1'),
      registerDevice: vi.fn().mockResolvedValue({
        profile: { id: 'same-api-profile' },
        account: { id: 'same-api-account' },
      }),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-same-api',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-same-api&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'same-api-device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValue(null),
    };

    const result = await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'same-api-token' },
      },
      client,
      enqueueInstruction: vi.fn(),
    });

    expect(stripAnsi(result || '')).toContain('Relay: listening for mobile prompts');
    expect(validateAuthSession).not.toHaveBeenCalled();
    expect(mobileTerminalReporterConstructed).toHaveBeenCalledWith(expect.objectContaining({
      owner: {
        profileId: 'same-api-profile',
        accountId: 'same-api-account',
      },
    }));
    stopMobileRelay();
  });

  it('keeps legacy profile-only API responses on direct terminal retries without creating an outbox', async () => {
    let relay: Parameters<NonNullable<Parameters<typeof go>[0]['onMobileRelayReady']>>[0] | undefined;
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('legacy-device-1'),
      registerDevice: vi.fn().mockResolvedValue({ profile: { id: 'legacy-profile-only' } }),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-legacy-api',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-legacy-api&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'legacy-device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValue(null),
      updateWork: vi.fn().mockResolvedValue({}),
      publishMobileEvent: vi.fn().mockResolvedValue(undefined),
    };

    const result = await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'legacy-api-token' },
      },
      client,
      enqueueInstruction: vi.fn(),
      onMobileRelayReady: (controller) => { relay = controller; },
    });

    expect(stripAnsi(result || '')).toContain('Relay: listening for mobile prompts');
    expect(mobileTerminalReporterConstructed).not.toHaveBeenCalled();
    await relay!.finishClaimedTurn({
      workId: 'legacy-work',
      prompt: 'legacy prompt',
      startedAt: '2026-05-13T00:00:00.000Z',
    }, { status: 'completed', output: 'done' });
    expect(client.updateWork).toHaveBeenCalledWith(
      'legacy-api-token',
      'legacy-device-1',
      'legacy-work',
      expect.objectContaining({ status: 'completed' }),
    );
    stopMobileRelay();
  });

  it('uses the registration owner instead of a stale cached profile for the outbox scope', async () => {
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('shared-device-1'),
      registerDevice: vi.fn().mockResolvedValue({
        profile: { id: 'current-profile-b' },
        account: { id: 'current-account-b' },
      }),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-current-account',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-current-account&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'shared-device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValue(null),
    };

    await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: {
          token: 'current-account-token',
          user: {
            id: 'stale-profile-a',
            email: 'stale@example.com',
            name: 'Stale User',
          },
        },
      },
      client,
      enqueueInstruction: vi.fn(),
    });

    expect(validateAuthSession).not.toHaveBeenCalled();
    expect(mobileTerminalReporterConstructed).toHaveBeenCalledWith(expect.objectContaining({
      owner: {
        profileId: 'current-profile-b',
        accountId: 'current-account-b',
      },
    }));
    expect(mobileTerminalReporterConstructed).not.toHaveBeenCalledWith(expect.objectContaining({
      owner: expect.objectContaining({ profileId: 'stale-profile-a' }),
    }));
    stopMobileRelay();
  });

  it('surfaces a revoked pairing through the relay disconnect callback', async () => {
    const onMobileDisconnected = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({
        pairingClaimed: false,
        pairingStatus: 'revoked',
      }),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-1',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-1&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValue(null),
    };

    await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'token', user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
      },
      client,
      enqueueInstruction: vi.fn(),
      onMobileDisconnected,
    });

    try {
      await vi.waitFor(() => expect(onMobileDisconnected).toHaveBeenCalledOnce());
      expect(onMobileDisconnected).toHaveBeenCalledWith('Mobile disconnected. Pairing stopped.');
      expect(client.claimWork).not.toHaveBeenCalled();
    } finally {
      stopMobileRelay();
    }
  });

  it('keeps live steering active when relay heartbeat fails', async () => {
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      sendRelayHeartbeat: vi.fn().mockRejectedValue(new Error('heartbeat unavailable')),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-1',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-1&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValueOnce({
        id: 'work-1',
        repo: 'project',
        branch: 'main',
        prompt: 'review the diff from mobile',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'session-1',
          pairingId: 'pairing-1',
          images: [{
            data: 'iVBORw0KGgo=',
            mimeType: 'image/png',
            filename: 'screen.png',
          }],
        },
        createdAt: '2026-05-13T00:00:00.000Z',
        updatedAt: '2026-05-13T00:00:01.000Z',
      }),
    };
    const enqueueInstruction = vi.fn();
    const enqueueInstructionWithImages = vi.fn();

    const result = await go({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'token', user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
      },
      client,
      enqueueInstruction,
      enqueueInstructionWithImages,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(stripAnsi(result || '')).toContain('Relay: listening for mobile prompts');
    expect(client.sendRelayHeartbeat).toHaveBeenCalled();
    expect(client.claimWork).toHaveBeenCalledWith('token', 'device-1', {
      deliveryMode: 'steer',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
    });
    expect(enqueueInstructionWithImages).toHaveBeenCalledWith('review the diff from mobile', [{
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
      filename: 'screen.png',
    }], expect.objectContaining({
      turn: expect.objectContaining({ workId: 'work-1' }),
      relay: expect.any(Object),
    }));
    expect(enqueueInstruction).not.toHaveBeenCalled();
    stopMobileRelay();
  });
});

describe('/handoff session command', () => {
  it('stays behind experimental_handoff by default', async () => {
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn(),
      registerDevice: vi.fn(),
      sendRelayHeartbeat: vi.fn(),
      createPairing: vi.fn(),
      claimWork: vi.fn(),
    };

    const result = await handoffSession({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      config: {
        configPath: '/tmp/config.json',
        auth: { token: 'token', user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
      },
      client,
    });

    expect(stripAnsi(result || '')).toContain('experimental_handoff');
    expect(client.createPairing).not.toHaveBeenCalled();
  });

  it('creates a handoff after experimental_handoff is enabled', async () => {
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn().mockResolvedValue({
        id: 'pairing-1',
        pairingUrl: 'https://autohand.ai/code/go?pairing=pairing-1&token=secret',
        expiresAt: '2026-05-13T00:10:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'session-1',
          deviceId: 'device-1',
          workspacePath: '/Users/test/project',
          projectName: 'project',
          model: 'gpt-5.3-codex',
          provider: 'openai',
        },
      }),
      claimWork: vi.fn().mockResolvedValue(null),
    };
    const trackFeatureActivation = vi.fn();

    const result = await handoffSession({
      sessionManager: createSessionManager(createSession()),
      workspaceRoot: '/Users/test/project',
      model: 'gpt-5.3-codex',
      provider: 'openai',
      config: {
        configPath: '/tmp/config.json',
        features: { experimentalHandoff: true },
        auth: { token: 'token', user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
      },
      client,
      trackFeatureActivation,
    });

    expect(stripAnsi(result || '')).toContain('Autohand Code mobile handoff');
    expect(client.createPairing).toHaveBeenCalled();
    expect(trackFeatureActivation).toHaveBeenCalledWith('experimental_handoff', { surface: 'slash_command' });
  });
});
