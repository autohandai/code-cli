import { describe, it, expect, vi } from 'vitest';

describe('sqlite mock', () => {
  it('should work with dynamic import', async () => {
    const mockPrepare = vi.fn();
    const mockClose = vi.fn();
    const MockDatabaseSync = vi.fn().mockImplementation(function () {
      return { prepare: mockPrepare, close: mockClose };
    });

    const mod = await import('node:sqlite');
    expect(typeof mod.DatabaseSync).toBe('function');
    mod.DatabaseSync.mockImplementation(MockDatabaseSync);
    const instance = new mod.DatabaseSync('/test.db', {});
    expect(instance.prepare).toBe(mockPrepare);
  });
});
