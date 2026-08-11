/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';

import {
  BlueprintSetupSessionManager,
  createSetupOnlyRuntimeProfile,
} from '../../../src/modes/rpc/blueprintSetup.js';
import { handleBlueprintSetupRpcRequest } from '../../../src/modes/rpc/blueprintSetupRpc.js';

const beginParams = {
  contractVersion: 1,
  trafficClass: 'autohand_device_authorization',
} as const;
const sessionParams = {
  contractVersion: 1,
  sessionId: '0123456789abcdef0123456789abcdef',
} as const;

describe('Blueprint setup-only device authorization', () => {
  it('is mutually exclusive with answer-only and disables every unrelated capability', () => {
    expect(createSetupOnlyRuntimeProfile({
      setupOnly: true,
      answerOnly: false,
      restricted: true,
      clientContext: 'blueprint',
    })).toEqual({
      setupOnly: true,
      answerOnly: false,
      clientContext: 'blueprint',
      permissionMode: 'restricted',
      trafficClass: 'autohand_device_authorization',
      toolsEnabled: false,
      hooksEnabled: false,
      mcpEnabled: false,
      memoryEnabled: false,
      telemetryEnabled: false,
      backgroundWorkEnabled: false,
      browserEnabled: false,
      sessionPersistenceEnabled: false,
    });

    expect(() => createSetupOnlyRuntimeProfile({
      setupOnly: true,
      answerOnly: true,
      restricted: true,
      clientContext: 'blueprint',
    })).toThrowError(expect.objectContaining({ kind: 'profile_violation' }));
  });

  it('returns only the user-safe challenge and keeps deviceCode private', async () => {
    const pollDeviceAuth = vi.fn();
    const initiateDeviceAuth = vi.fn(async () => ({
      success: true,
      deviceCode: 'private-device-code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://autohand.ai/signin',
      verificationUriComplete:
        'https://autohand.ai/signin?continue=signed-opaque&user_code=ABCD-EFGH',
      expiresIn: 300,
      interval: 2,
    }));
    const manager = new BlueprintSetupSessionManager({
      authClient: {
        initiateDeviceAuth,
        pollDeviceAuth,
        cancelDeviceAuth: vi.fn(),
      },
      persistCredentials: vi.fn(),
      now: () => 1_785_299_700_000,
      createSessionId: () => sessionParams.sessionId,
    });

    const result = await manager.begin(beginParams);

    expect(result).toEqual({
      contractVersion: 1,
      sessionId: sessionParams.sessionId,
      userCode: 'ABCD-EFGH',
      verificationUriComplete:
        'https://autohand.ai/signin?continue=signed-opaque&user_code=ABCD-EFGH',
      expiresAtUnixMs: 1_785_300_000_000,
      pollAfterMs: 2000,
    });
    expect(JSON.stringify(result)).not.toContain('private-device-code');
    expect(initiateDeviceAuth).toHaveBeenCalledWith('blueprint');
    expect(pollDeviceAuth).not.toHaveBeenCalled();
  });

  it('rejects a challenge outside the exact Autohand signin contract', async () => {
    const manager = new BlueprintSetupSessionManager({
      authClient: {
        initiateDeviceAuth: vi.fn(async () => ({
          success: true,
          deviceCode: 'private-device-code',
          userCode: 'ABCD-EFGH',
          verificationUriComplete:
            'https://evil.example/signin?continue=signed-opaque&user_code=ABCD-EFGH',
          expiresIn: 300,
          interval: 2,
        })),
        pollDeviceAuth: vi.fn(),
        cancelDeviceAuth: vi.fn(),
      },
      persistCredentials: vi.fn(),
    });

    await expect(manager.begin(beginParams)).rejects.toMatchObject({
      kind: 'invalid_challenge',
    });
  });

  it('polls with the private device code and persists credentials before authorized', async () => {
    const persistCredentials = vi.fn(async () => {});
    const pollDeviceAuth = vi.fn(async () => ({
      success: true,
      status: 'authorized' as const,
      token: 'private-token',
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    }));
    let now = 1_785_299_700_000;
    const manager = new BlueprintSetupSessionManager({
      authClient: {
        initiateDeviceAuth: vi.fn(async () => ({
          success: true,
          deviceCode: 'private-device-code',
          userCode: 'ABCD-EFGH',
          verificationUriComplete:
            'https://autohand.ai/signin?continue=signed-opaque&user_code=ABCD-EFGH',
          expiresIn: 300,
          interval: 2,
        })),
        pollDeviceAuth,
        cancelDeviceAuth: vi.fn(),
      },
      persistCredentials,
      now: () => now,
      createSessionId: () => sessionParams.sessionId,
    });
    await manager.begin(beginParams);
    now += 2000;

    const result = await manager.poll(sessionParams);

    expect(pollDeviceAuth).toHaveBeenCalledWith('private-device-code');
    expect(persistCredentials).toHaveBeenCalledWith(
      'private-token',
      { id: 'user-1', email: 'user@example.com', name: 'User' },
    );
    expect(result).toEqual({ contractVersion: 1, status: 'authorized' });
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('never returns an early-poll delay below the schema minimum', async () => {
    let now = 1_785_299_700_000;
    const pollDeviceAuth = vi.fn();
    const manager = new BlueprintSetupSessionManager({
      authClient: {
        initiateDeviceAuth: vi.fn(async () => ({
          success: true,
          deviceCode: 'private-device-code',
          userCode: 'ABCD-EFGH',
          verificationUriComplete:
            'https://autohand.ai/signin?continue=signed-opaque&user_code=ABCD-EFGH',
          expiresIn: 300,
          interval: 2,
        })),
        pollDeviceAuth,
        cancelDeviceAuth: vi.fn(),
      },
      persistCredentials: vi.fn(),
      now: () => now,
      createSessionId: () => sessionParams.sessionId,
    });
    await manager.begin(beginParams);
    now += 1501;

    await expect(manager.poll(sessionParams)).resolves.toEqual({
      contractVersion: 1,
      status: 'pending',
      pollAfterMs: 1000,
    });
    expect(pollDeviceAuth).not.toHaveBeenCalled();
  });

  it('does not report authorized when credential persistence fails', async () => {
    let now = 1_785_299_700_000;
    const manager = new BlueprintSetupSessionManager({
      authClient: {
        initiateDeviceAuth: vi.fn(async () => ({
          success: true,
          deviceCode: 'private-device-code',
          userCode: 'ABCD-EFGH',
          verificationUriComplete:
            'https://autohand.ai/signin?continue=signed-opaque&user_code=ABCD-EFGH',
          expiresIn: 300,
          interval: 2,
        })),
        pollDeviceAuth: vi.fn(async () => ({
          success: true,
          status: 'authorized' as const,
          token: 'private-token',
          user: { id: 'user-1', email: 'user@example.com', name: 'User' },
        })),
        cancelDeviceAuth: vi.fn(),
      },
      persistCredentials: vi.fn(async () => {
        throw new Error('disk full');
      }),
      now: () => now,
      createSessionId: () => sessionParams.sessionId,
    });
    await manager.begin(beginParams);
    now += 2000;

    await expect(manager.poll(sessionParams)).resolves.toEqual({
      contractVersion: 1,
      status: 'failed',
      problem: {
        code: 'credential_persistence_failed',
        message: 'Autohand credentials could not be saved.',
        retryable: true,
      },
    });
  });

  it('does not report authorized for an undeclared API status carrying credentials', async () => {
    let now = 1_785_299_700_000;
    const persistCredentials = vi.fn();
    const manager = new BlueprintSetupSessionManager({
      authClient: {
        initiateDeviceAuth: vi.fn(async () => ({
          success: true,
          deviceCode: 'private-device-code',
          userCode: 'ABCD-EFGH',
          verificationUriComplete:
            'https://autohand.ai/signin?continue=signed-opaque&user_code=ABCD-EFGH',
          expiresIn: 300,
          interval: 2,
        })),
        pollDeviceAuth: vi.fn(async () => ({
          success: true,
          status: 'unexpected' as 'authorized',
          token: 'private-token',
          user: { id: 'user-1', email: 'user@example.com', name: 'User' },
        })),
        cancelDeviceAuth: vi.fn(),
      },
      persistCredentials,
      now: () => now,
      createSessionId: () => sessionParams.sessionId,
    });
    await manager.begin(beginParams);
    now += 2000;

    await expect(manager.poll(sessionParams)).resolves.toMatchObject({
      contractVersion: 1,
      status: 'failed',
      problem: { code: 'protocol_mismatch', retryable: false },
    });
    expect(persistCredentials).not.toHaveBeenCalled();
  });

  it('cancels through the API before returning a cancelled terminal status', async () => {
    const cancelDeviceAuth = vi.fn(async () => ({ success: true }));
    const manager = new BlueprintSetupSessionManager({
      authClient: {
        initiateDeviceAuth: vi.fn(async () => ({
          success: true,
          deviceCode: 'private-device-code',
          userCode: 'ABCD-EFGH',
          verificationUriComplete:
            'https://autohand.ai/signin?continue=signed-opaque&user_code=ABCD-EFGH',
          expiresIn: 300,
          interval: 2,
        })),
        pollDeviceAuth: vi.fn(),
        cancelDeviceAuth,
      },
      persistCredentials: vi.fn(),
      createSessionId: () => sessionParams.sessionId,
    });
    await manager.begin(beginParams);

    const result = await manager.cancel(sessionParams);

    expect(cancelDeviceAuth).toHaveBeenCalledWith('private-device-code');
    expect(result).toEqual({ contractVersion: 1, status: 'cancelled' });
  });

  it('rejects every non-setup method as a terminal profile error', async () => {
    const outcome = await handleBlueprintSetupRpcRequest({
      jsonrpc: '2.0',
      method: 'autohand.prompt',
      params: { message: 'workspace content must not enter setup' },
      id: 7,
    }, {} as BlueprintSetupSessionManager);

    expect(outcome).toMatchObject({
      terminal: true,
      response: {
        id: 7,
        error: {
          code: -32014,
          data: { kind: 'profile_violation', retryable: false },
        },
      },
    });
  });
});
