/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthClient } from '../../src/auth/AuthClient.js';

const deviceCode = 'D'.repeat(43);
const continuation = [
  'v1',
  'current',
  'eyJhdWQiOiJhdXRvaGFuZC1zaXRlLWNsaS1hdXRoLXYxIn0',
  'S'.repeat(43),
].join('.');
const completionUrl = `https://autohand.ai/signin?continue=${continuation}&user_code=TEST-CAFE`;
const credential = `ahc_${'C'.repeat(43)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AuthClient canonical device authorization contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends schema v1 and accepts only the signed API-returned sign-in URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      schemaVersion: 1,
      deviceCode,
      userCode: 'TEST-CAFE',
      verificationUri: 'https://autohand.ai/signin',
      verificationUriComplete: completionUrl,
      expiresIn: 300,
      interval: 5,
    }, 201));
    const client = new AuthClient({ baseUrl: 'https://api.autohand.ai/v1/auth' });

    await expect(client.initiateDeviceAuth()).resolves.toMatchObject({
      success: true,
      schemaVersion: 1,
      deviceCode,
      verificationUriComplete: completionUrl,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.autohand.ai/v1/auth/cli/initiate',
      expect.objectContaining({
        body: JSON.stringify({ clientId: 'autohand-cli', schemaVersion: 1 }),
      }),
    );
  });

  it('rejects malformed or device-code-bearing continuations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      success: true,
      schemaVersion: 1,
      deviceCode,
      userCode: 'TEST-CAFE',
      verificationUri: 'https://autohand.ai/signin',
      verificationUriComplete:
        `https://autohand.ai/signin?continue=${continuation}&user_code=TEST-CAFE&device_code=${deviceCode}`,
      expiresIn: 300,
      interval: 5,
    }, 201));
    const client = new AuthClient({ baseUrl: 'https://api.autohand.ai/v1/auth' });

    await expect(client.initiateDeviceAuth()).resolves.toEqual({
      success: false,
      error: 'Autohand returned an invalid device-authorization challenge.',
    });
  });

  it('validates authorized and pending poll payloads before returning them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        schemaVersion: 1,
        status: 'pending',
        interval: 5,
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        schemaVersion: 1,
        status: 'authorized',
        token: credential,
        user: {
          id: 'user-1',
          email: 'user@example.test',
          name: 'Example User',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        schemaVersion: 1,
        status: 'authorized',
        user: {
          id: 'user-1',
          email: 'user@example.test',
          name: 'Example User',
        },
      }));
    const client = new AuthClient({ baseUrl: 'https://api.autohand.ai/v1/auth' });

    await expect(client.pollDeviceAuth(deviceCode)).resolves.toMatchObject({
      success: true,
      status: 'pending',
      interval: 5,
    });
    await expect(client.pollDeviceAuth(deviceCode)).resolves.toMatchObject({
      success: true,
      status: 'authorized',
      token: credential,
    });
    await expect(client.pollDeviceAuth(deviceCode)).resolves.toEqual({
      success: false,
      status: 'pending',
      error: 'Autohand returned an invalid device-authorization status.',
    });
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ deviceCode, schemaVersion: 1 }),
      JSON.stringify({ deviceCode, schemaVersion: 1 }),
      JSON.stringify({ deviceCode, schemaVersion: 1 }),
    ]);
  });
});
