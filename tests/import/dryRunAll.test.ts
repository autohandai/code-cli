import { describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({ imports: vi.fn(), preview: vi.fn() }));
vi.mock('../../src/import/registry.js', () => ({ ImporterRegistry: class {
  async detectAvailable() { return [
    { name: 'claude', displayName: 'Claude Code', scan: async () => ({ available: new Map([['settings', { count: 1, description: 'Settings' }]]) }), import: fixtures.imports,
      previewSettings: async () => { fixtures.preview(); return { allow: 1, deny: 1, repositories: 0, skipped: 0, mappings: [], legacySettingsScrubbed: false, legacySettingsToScrub: [] }; } },
    { name: 'codex', displayName: 'Codex', scan: async () => ({ available: new Map([['settings', { count: 1, description: 'Settings' }]]) }), import: fixtures.imports },
  ]; }
} }));
import { runImport } from '../../src/import/index.js';
describe('dry run across all detected sources', () => {
  it('previews selected categories and mappings without invoking any import', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    fixtures.imports.mockResolvedValue({ source: 'fixture', imported: new Map(), errors: [], duration: 0 });
    try {
      await runImport({ all: true, dryRun: true, categories: ['settings'] });
      expect(fixtures.imports).not.toHaveBeenCalled();
      expect(fixtures.preview).toHaveBeenCalledOnce();
      expect(output.mock.calls.flat().join('\n')).toContain('Would translate 1 allow and 1 deny');
    } finally { output.mockRestore(); }
  });
});
