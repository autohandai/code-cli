import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthClient } from '../../src/auth/AuthClient.js';
import { selectedAccountId } from '../../src/auth/accountSelection.js';
import type { LoadedConfig } from '../../src/types.js';

const config = (accountId?: string) => ({ api: accountId ? { accountId } : undefined }) as unknown as LoadedConfig;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AUTOHAND_ACCOUNT_ID;
});

describe('selectedAccountId', () => {
  it('prefers the environment over the saved choice and ignores blanks', () => {
    expect(selectedAccountId(config())).toBeUndefined();
    expect(selectedAccountId(config('team_1'))).toBe('team_1');
    process.env.AUTOHAND_ACCOUNT_ID = ' team_env ';
    expect(selectedAccountId(config('team_1'))).toBe('team_env');
    process.env.AUTOHAND_ACCOUNT_ID = '   ';
    expect(selectedAccountId(config(' '))).toBeUndefined();
  });
});

describe('AuthClient accounts', () => {
  const client = new AuthClient({ baseUrl: 'https://api.test/v1/auth' });

  it('lists accounts with the API default and sends the chosen account on every call', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/accounts')) {
        return Response.json({
          success: true,
          activeAccountId: 'team_9',
          accounts: [
            { account: { id: 'personal_1', name: 'Ada', type: 'personal' }, role: 'owner', permissions: [] },
            { account: { id: 'team_9', name: 'Acme', type: 'team' }, role: 'contributor', permissions: [] },
            { account: { id: 'ent', name: 'Nope', type: 'enterprise' }, role: 'admin', permissions: [] },
          ],
        });
      }
      return Response.json({ user: { id: 'u' }, entitlement: { tier: 'team' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await client.listAccounts('tok', 'team_9')).toEqual({
      activeAccountId: 'team_9',
      accounts: [
        { id: 'personal_1', name: 'Ada', type: 'personal', role: 'owner' },
        { id: 'team_9', name: 'Acme', type: 'team', role: 'contributor' },
      ],
    });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-Autohand-Account-Id')).toBe('team_9');

    const entitlement = await client.fetchEntitlement('tok', 'team_9');
    expect(entitlement).toMatchObject({ tier: 'team', accountName: 'Acme' });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('X-Autohand-Account-Id')).toBe('team_9');
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('X-Autohand-Account-Id')).toBe('team_9');
  });

  it('sends no account header when nothing is chosen', async () => {
    const fetchMock = vi.fn(async () => Response.json({ user: { id: 'u' }, entitlement: { tier: 'free', freeRemaining: 20 } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await client.fetchEntitlement('tok')).toMatchObject({ tier: 'free' });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('X-Autohand-Account-Id')).toBe(false);
  });
});
