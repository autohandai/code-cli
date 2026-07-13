/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { go, handoffSession } from '../../src/commands/go.js';
import { stopMobileRelay } from '../../src/mobile/MobileRelay.js';
import type { MobileHandoffClientLike } from '../../src/mobile/MobileHandoffClient.js';
import type { Session, SessionManager } from '../../src/session/SessionManager.js';

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
          payload: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:01.000Z',
        })
        .mockResolvedValue(null),
    };
    const enqueueInstruction = vi.fn();

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
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(stripAnsi(result || '')).toContain('Relay: listening for mobile prompts');
    expect(client.sendRelayHeartbeat).toHaveBeenCalledWith('token', {
      sessionId: 'session-1',
      deviceId: 'device-1',
      pairingId: 'pairing-1',
      mode: 'steer',
    });
    expect(client.claimWork).toHaveBeenCalledWith('token', 'device-1');
    expect(enqueueInstruction).toHaveBeenCalledWith('hello from iPhone');
    stopMobileRelay();
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
    expect(client.claimWork).toHaveBeenCalledWith('token', 'device-1');
    expect(enqueueInstructionWithImages).toHaveBeenCalledWith('review the diff from mobile', [{
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
      filename: 'screen.png',
    }]);
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
