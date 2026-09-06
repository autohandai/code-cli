import { describe, expect, it, vi } from 'vitest';
import { execute } from '../../src/commands/import.js';
import { runImport } from '../../src/import/index.js';
vi.mock('../../src/import/index.js', () => ({ runImport: vi.fn() }));

describe('/import arguments', () => {
  it('passes hook selection and current workspace/config into import', async () => {
    await execute(['claude', '--categories', 'hooks', '--dry-run'], { workspaceRoot: '/project', configPath: '/config.json' });
    expect(runImport).toHaveBeenCalledWith(expect.objectContaining({ source: 'claude', categories: ['hooks'], dryRun: true, workspaceRoot: '/project', configPath: '/config.json' }));
  });
  it('accepts flags before a source and comma separated categories', async () => {
    await execute(['--all', '--categories=hooks,skills']);
    expect(runImport).toHaveBeenLastCalledWith(expect.objectContaining({ source: undefined, all: true, categories: ['hooks', 'skills'] }));
  });
  it('rejects unknown categories without starting import', async () => {
    vi.mocked(runImport).mockClear();
    expect(await execute(['cursor', '--categories', 'invalid'])).toContain('Unknown import category');
    expect(runImport).not.toHaveBeenCalled();
  });
});
