import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resolveCommand = vi.hoisted(() => vi.fn(() => 'rg'));
vi.mock('../../src/utils/ripgrep.js', () => ({ resolveRipgrepCommand: resolveCommand }));
const fixtureRoot = fileURLToPath(new URL('../../.test-artifacts/f0378/', import.meta.url));
let workspace: string;

beforeEach(async () => {
  await fs.mkdir(fixtureRoot, { recursive: true });
  workspace = await fs.mkdtemp(path.join(fixtureRoot, 'glob-'));
  for (const [name, timestamp] of [
    ['src/old.test.ts', 1000], ['tests/new.test.ts', 3000],
    ['root.test.ts', 2000], ['src/auth/controller.ts', 4000],
    ['src/auth_controller.ts', 5000], ['tests/no.txt', 6000],
  ] as const) {
    const file = path.join(workspace, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, name);
    await fs.utimes(file, timestamp, timestamp);
  }
});
afterEach(async () => { await fs.rm(workspace, { recursive: true, force: true }); });

for (const backend of ['ripgrep', 'walk'] as const) {
  describe(`${backend} glob file search`, () => {
    beforeEach(() => resolveCommand.mockReturnValue(backend === 'ripgrep' ? 'rg' : '__missing_f0378_rg__'));
    async function search(query: string, limit = 50) {
      const { FFFSearchProvider } = await import('../../src/search/fffSearchProvider.js');
      const provider = await FFFSearchProvider.create(workspace, { background: false });
      try { return await provider.fileSearch({ query, limit }); } finally { provider.destroy(); }
    }
    it('finds nested and root test files, newest first, capped after sorting', async () => {
      expect(await search('**/*.test.ts', 2)).toBe('tests/new.test.ts\nroot.test.ts');
    });
    it('applies basename patterns throughout the workspace', async () => {
      expect(await search('*.test.ts')).toBe('tests/new.test.ts\nroot.test.ts\nsrc/old.test.ts');
    });
    it.each(['tests/???.test.ts', 'tests/[n]ew.test.ts', 'tests/*.{ts,tsx}'])('handles %s', async query => {
      expect(await search(query)).toBe('tests/new.test.ts');
    });
    it('keeps ordinary multi-word ranking unchanged', async () => {
      const files = (await search('auth controller')).split('\n').map(p => p.replace(/^\.\//, ''));
      expect(files).toEqual(['src/auth_controller.ts', 'src/auth/controller.ts']);
    });
    it('reports an unmatched glob without substring matches', async () => {
      expect(await search('**/*.rs')).toBe('No files found.');
    });
    it('leaves ignored dependency directories out', async () => {
      await fs.mkdir(path.join(workspace, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'node_modules/dep.test.ts'), 'dependency');
      await fs.writeFile(path.join(workspace, '.gitignore'), 'node_modules/\n');
      await fs.mkdir(path.join(workspace, '.git'));
      expect(await search('*.test.ts')).not.toContain('dep.test.ts');
    });
  });
}
