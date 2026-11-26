import { describe, expect, it } from 'vitest';
import { isPeerCommunicationAvailable, resolvePeerCommunicationSettings } from '../../../src/session/peers/PeerSettings.js';

describe('peer communication configuration', () => {
  it('enables communication by default without changing awareness', () => {
    expect(resolvePeerCommunicationSettings({})).toMatchObject({ enabled: true, scope: 'workspace', idleBehavior: 'notify' });
    expect(resolvePeerCommunicationSettings({ sessions: { awareness: 'coordinate' } }).enabled).toBe(true);
  });

  it('reports configured intent independently of the host platform', () => {
    expect(resolvePeerCommunicationSettings({}).enabled).toBe(true);
  });

  it('honors an explicit opt-out', () => {
    expect(resolvePeerCommunicationSettings({ sessions: { communication: { enabled: false } } })).toMatchObject({ enabled: false, scope: 'workspace', idleBehavior: 'notify' });
  });

  it('enables only the user-selected scope and idle policy', () => {
    expect(resolvePeerCommunicationSettings({ sessions: { communication: { enabled: true, scope: 'repository', idleBehavior: 'auto' } } })).toMatchObject({ enabled: true, scope: 'repository', idleBehavior: 'auto' });
  });

  it('uses conservative transport and retention defaults', () => {
    const settings = resolvePeerCommunicationSettings({ sessions: { communication: { enabled: true } } });
    expect(settings.limits).toMatchObject({ frameBytes: 65_536, messageBytes: 8_000, inboxMessages: 32, pendingRequests: 32, connections: 16, storageBytes: 10 * 1024 * 1024, ratePerSecond: 10, rateBurst: 20, handshakeMs: 2_000, acknowledgementMs: 2_000, expiryMs: 600_000, maxExpiryMs: 3_600_000, retentionMs: 86_400_000, automaticReplies: 8 });
  });

  it.each([
    { enabled: 'yes' }, { scope: 'internet' }, { idleBehavior: 'execute_everything' },
    { alias: '../escape' }, { limits: { messageBytes: -1 } }, { limits: { inboxMessages: 1.5 } },
    { limits: { storageBytes: Number.POSITIVE_INFINITY } },
  ])('rejects invalid communication settings without widening access: %j', communication => {
    expect(() => resolvePeerCommunicationSettings({ sessions: { communication } })).toThrow(/communication|peer|limit|alias/i);
  });
});

describe('effective peer communication availability', () => {
  it('is available by default on POSIX platforms', () => {
    expect(isPeerCommunicationAvailable(undefined, 'darwin')).toBe(true);
    expect(isPeerCommunicationAvailable({}, 'linux')).toBe(true);
    expect(isPeerCommunicationAvailable({ enabled: true }, 'linux')).toBe(true);
  });

  it('stays inert on Windows even when explicitly enabled', () => {
    expect(isPeerCommunicationAvailable(undefined, 'win32')).toBe(false);
    expect(isPeerCommunicationAvailable({ enabled: true }, 'win32')).toBe(false);
  });

  it('honors an explicit opt-out on every platform', () => {
    expect(isPeerCommunicationAvailable({ enabled: false }, 'darwin')).toBe(false);
    expect(isPeerCommunicationAvailable({ enabled: false }, 'win32')).toBe(false);
  });
});
