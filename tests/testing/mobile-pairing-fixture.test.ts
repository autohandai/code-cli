/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileHandoffClient } from '../../src/mobile/MobileHandoffClient.js';
import { createMockMobilePairingFetchPreload } from '../tuistory/helpers/autohandTuistory.js';

afterEach(() => vi.unstubAllGlobals());

describe('mobile pairing terminal fixture', () => {
  it('serves the active relay without falling through to external network requests', async () => {
    const externalFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected external request'));
    vi.stubGlobal('fetch', externalFetch);
    const preload = await createMockMobilePairingFetchPreload();
    try {
      await import(preload.importSpecifier);
      const client = new MobileHandoffClient({ baseUrl: 'https://api.tuistory.test' });

      await expect(client.sendRelayHeartbeat('fixture-token', {
        sessionId: 'fixture-session', deviceId: 'fixture-device', mode: 'queue',
      })).resolves.toEqual({ pairingClaimed: false, pairingStatus: 'pending' });
      await expect(client.claimWork('fixture-token', 'fixture-device')).resolves.toBeNull();
      await expect(client.publishMobileEvent('fixture-token', {
        sessionId: 'fixture-session', deviceId: 'fixture-device',
        eventType: 'keep_awake_status', payload: { supported: true, enabled: true },
      })).resolves.toBeUndefined();
      await expect(client.pollMobileActions('fixture-token', 'fixture-session', 'fixture-device', 0))
        .resolves.toEqual({ success: true, actions: [], cursor: 0 });
      for (const [url, expected] of [
        ['https://openrouter.ai/api/v1/models', { data: [] }],
        ['https://api.tuistory.test/v1/feature-flags/evaluate?clientType=cli', { success: true, flags: [] }],
        ['https://api.tuistory.test/v1/announcements?clientType=cli', { success: true, announcements: [] }],
      ] as const) {
        await expect(fetch(url).then(response => response.json())).resolves.toEqual(expected);
      }
      await expect(fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' })
        .then(response => response.json())).resolves.toMatchObject({
          choices: [{ message: { role: 'assistant', content: 'Mobile pairing ready.' } }],
        });
      expect(externalFetch).not.toHaveBeenCalled();
    } finally {
      await preload.cleanup();
    }
  });
});
