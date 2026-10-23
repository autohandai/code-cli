import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import { createTempAutohandHome, launchBuiltAutohand, waitForExit, expectCleanExit } from './helpers/autohandTuistory.js';

describe('built Claude permission import', () => {
  it('previews mappings without writes, then imports and reports legacy cleanup in the terminal', async () => {
    const state = await createTempAutohandHome();
    const source = path.join(state.workspaceRoot, 'claude-fixture');
    const legacy = path.join(state.autohandHome, 'imported-claude-settings.json');
    await fs.outputJson(path.join(source, 'settings.json'), { env: { TOKEN: 'NEVER_COPY_ENV' }, permissions: { allow: ['Bash(npm test:*)', 'Read(./src/**)'], deny: ['Bash(rm:*)', 'UnknownTool(example)'] } });
    await fs.outputJson(legacy, { raw: { env: { TOKEN: 'SCRUB_LEGACY_ENV' } } });
    const beforeConfig = await fs.readFile(state.configPath, 'utf8');
    const beforeLegacy = await fs.readFile(legacy, 'utf8');
    const args = ['--path', state.workspaceRoot, '--config', state.configPath, 'import', 'claude', '--categories', 'settings'];
    try {
      const preview = await launchBuiltAutohand([...args, '--dry-run'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { CLAUDE_CONFIG_DIR: source }, rows: 48 });
      try {
        await waitForExit(preview, 30_000);
        expectCleanExit(preview);
        const text = await preview.text({ immediate: true });
        expect(text).toContain('Would translate 2 allow and 1 deny');
        expect(text).toContain('run_command:npm test*');
        expect(text).toContain('skipped (no equivalent)');
        expect(text).not.toContain('NEVER_COPY_ENV');
        expect(await fs.readFile(state.configPath, 'utf8')).toBe(beforeConfig);
        expect(await fs.readFile(legacy, 'utf8')).toBe(beforeLegacy);
      } finally { preview.close(); }
      const imported = await launchBuiltAutohand(args, { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { CLAUDE_CONFIG_DIR: source }, rows: 48 });
      try {
        await waitForExit(imported, 30_000);
        expectCleanExit(imported);
        const text = await imported.text({ immediate: true });
        expect(text).toContain('Translated 2 allow and 1 deny');
        expect(text).toContain('Scrubbed raw Claude settings');
        expect(text).not.toMatch(/NEVER_COPY_ENV|SCRUB_LEGACY_ENV/);
        expect((await fs.readJson(state.configPath)).permissions.denyList).toContain('run_command:rm*');
        expect(await fs.readJson(legacy)).not.toHaveProperty('raw');
      } finally { imported.close(); }
    } finally { await state.cleanup(); }
  });
});
