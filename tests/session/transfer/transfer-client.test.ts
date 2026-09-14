/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { SessionTransferClient } from '../../../src/session/transfer/transfer-client.js';

const identity = { token: 'token', userId: 'user-1' };
const transferId = '0123abcd-4567-4abc-8def-0123456789ab';

describe('SessionTransferClient body release', () => {
  it('cancels the body of a rejected download response', async () => {
    const response = new Response('unavailable', { status: 503 });
    const cancel = vi.spyOn(response.body!, 'cancel');
    const client = new SessionTransferClient(vi.fn().mockResolvedValue(response));

    await expect(client.download(transferId, identity)).rejects.toThrow(/could not complete/);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels the reader when the stream carries invalid data', async () => {
    const reader = {
      read: vi.fn().mockResolvedValue({ done: false, value: 'not bytes' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const response = {
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    } as unknown as Response;
    const client = new SessionTransferClient(vi.fn().mockResolvedValue(response));

    await expect(client.download(transferId, identity)).rejects.toThrow(/Invalid transfer response/);

    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });
});
