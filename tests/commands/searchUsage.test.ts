import { afterEach, describe, expect, it, vi } from 'vitest';
import { search } from '../../src/commands/search.js';
import { showModal } from '../../src/ui/ink/components/Modal.js';

vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal: vi.fn().mockResolvedValue(null), showPassword: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('/search Free daily usage', () => {
  it.each([7, 0])('shows %s remaining and retains Autohand as a selectable provider', async remaining => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ available: true, tier: 'free', provider: 'cloudflare', usage: { limit: 10, remaining, resetAt: '2026-10-27T00:00:00.000Z' } })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await search({ config: { configPath: '/fixture', auth: { token: 'ahc_verified_free' } } });
    const usage = `${remaining} of 10 free web searches left today. Resets at 00:00 UTC.`;
    expect(log.mock.calls.some(args => String(args[0]).includes(usage))).toBe(true);
    expect(showModal).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.arrayContaining([expect.objectContaining({ value: 'autohand', description: usage })]) }));
  });
});
