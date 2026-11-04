import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import { createTempAutohandHome, launchBuiltAutohand, waitForExit, expectCleanExit } from './helpers/autohandTuistory.js';

describe('built Claude permission import', () => {
  it('honors global dry-run and imports an alternate profile skill with its scripts', async () => {
    const state = await createTempAutohandHome();
    const source = path.join(state.workspaceRoot, 'alternate-profile');
    const folder = path.join(source, 'skills', 'review-package');
    await fs.outputFile(path.join(folder, 'SKILL.md'), '---\nname: review-package\ndescription: Review the project.\n---\nUse scripts/review.sh.\n');
    await fs.outputFile(path.join(folder, 'scripts', 'review.sh'), '#!/bin/sh\necho fixture\n');
    const destination = path.join(state.autohandHome, 'skills', 'imported-claude', 'review-package');
    const args = ['--path', state.workspaceRoot, '--config', state.configPath, 'import', 'claude', '--categories', 'skills'];
    try {
      const preview = await launchBuiltAutohand(['--dry-run', ...args], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { CLAUDE_CONFIG_DIR: source } });
      try { await waitForExit(preview, 30_000); expectCleanExit(preview); expect(preview.readAll()).toContain('1 skill'); } finally { preview.close(); }
      expect(await fs.pathExists(destination)).toBe(false);
      const imported = await launchBuiltAutohand(args, { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { CLAUDE_CONFIG_DIR: source } });
      try { await waitForExit(imported, 30_000); expectCleanExit(imported); } finally { imported.close(); }
      expect(await fs.readFile(path.join(destination, 'scripts', 'review.sh'), 'utf8')).toBe('#!/bin/sh\necho fixture\n');
      expect(await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8')).toContain('scripts/review.sh');
      await fs.outputFile(path.join(destination, 'scripts', 'review.sh'), 'LOCAL EDIT');
      const repeated = await launchBuiltAutohand(args, { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { CLAUDE_CONFIG_DIR: source } });
      try { await waitForExit(repeated, 30_000); expectCleanExit(repeated); } finally { repeated.close(); }
      expect(await fs.readFile(path.join(destination, 'scripts', 'review.sh'), 'utf8')).toBe('LOCAL EDIT');
    } finally { await state.cleanup(); }
  });

  it('previews mappings without writes, then imports and reports legacy cleanup in the terminal', async () => {
    const state = await createTempAutohandHome();
    const source = path.join(state.workspaceRoot, 'claude-fixture');
    const legacy = path.join(state.autohandHome, 'imported-claude-settings.json');
    await fs.outputJson(path.join(source, 'settings.json'), { env: { TOKEN: 'NEVER_COPY_ENV' }, permissions: { allow: ['Bash(npm test:*)', 'Read(./src/**)'], deny: ['Bash(rm:*)', 'UnknownTool(example)'] } });
    await fs.outputJson(legacy, { raw: { env: { TOKEN: 'SCRUB_LEGACY_ENV' } } });
    const beforeConfig = await fs.readFile(state.configPath, 'utf8');
    const beforeLegacy = await fs.readFile(legacy, 'utf8');
    const projectFile = path.join(state.workspaceRoot, '.autohand', 'settings.local.json');
    const hadProjectSettings = await fs.pathExists(projectFile);
    await fs.outputJson(path.join(state.workspaceRoot, '.mcp.json'), { mcpServers: {
      'private-fixture': { command: 'fixture-server', env: { TOKEN: 'MCP_TERMINAL_FIXTURE_SECRET' } },
    } });
    const args = ['--path', state.workspaceRoot, '--config', state.configPath, 'import', 'claude', '--categories', 'settings,mcp'];
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
        expect(await fs.pathExists(projectFile)).toBe(hadProjectSettings);
      } finally { preview.close(); }
      const imported = await launchBuiltAutohand(args, { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { CLAUDE_CONFIG_DIR: source }, rows: 48 });
      try {
        await waitForExit(imported, 30_000);
        expectCleanExit(imported);
        const text = await imported.text({ immediate: true });
        expect(text).toContain('Translated 2 allow and 1 deny');
        expect(text).toContain('Scrubbed raw Claude settings');
        expect(text).not.toMatch(/NEVER_COPY_ENV|SCRUB_LEGACY_ENV|MCP_TERMINAL_FIXTURE_SECRET/);
        expect((await fs.readJson(state.configPath)).permissions.denyList).toContain('run_command:rm*');
        expect(await fs.readJson(legacy)).not.toHaveProperty('raw');
        expect((await fs.readJson(projectFile)).mcp.servers).toContainEqual(expect.objectContaining({
          name: 'private-fixture', autoConnect: false, localOnly: true,
        }));
      } finally { imported.close(); }
    } finally { await state.cleanup(); }
  });
});
