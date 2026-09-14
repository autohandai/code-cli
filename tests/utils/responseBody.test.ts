/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { discardResponseBody } from '../../src/utils/responseBody.js';

describe('discardResponseBody', () => {
  it('cancels the body stream so the connection is released', () => {
    const cancel = vi.fn().mockResolvedValue(undefined);

    discardResponseBody({ body: { cancel } as unknown as ReadableStream<Uint8Array> });

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('is a no-op for a response without a body', () => {
    expect(() => discardResponseBody({ body: null })).not.toThrow();
  });

  it('swallows a rejected cancel so callers never see an unhandled rejection', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('already closed'));

    discardResponseBody({ body: { cancel } as unknown as ReadableStream<Uint8Array> });
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancel).toHaveBeenCalledOnce();
  });
});
