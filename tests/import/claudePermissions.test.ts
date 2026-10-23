import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixturePaths = vi.hoisted(() => ({ home: '/private/tmp/unused-claude-permission-fixture' }));
vi.mock('../../src/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/constants.js')>();
  return { ...actual, AUTOHAND_PATHS: { ...actual.AUTOHAND_PATHS, get config() { return fixturePaths.home; } } };
});

import { ClaudeImporter } from '../../src/import/importers/ClaudeImporter.js';
import { loadConfig, saveConfig } from '../../src/config.js';
import { trustWorkspace } from '../../src/permissions/workspaceTrust.js';
import { runImport } from '../../src/import/index.js';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';

describe('Claude permission settings import', () => {
  let root: string;
  let sourceHome: string;
  let workspaceRoot: string;
  let secondRepository: string;
  let configPath: string;
  let legacyPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-permission-import-'));
    sourceHome = path.join(root, 'claude');
    workspaceRoot = path.join(root, 'first-repo');
    secondRepository = path.join(root, 'second-repo-with-hyphens');
    fixturePaths.home = path.join(root, 'autohand');
    configPath = path.join(fixturePaths.home, 'config.json');
    legacyPath = path.join(fixturePaths.home, 'imported-claude-settings.json');
    await Promise.all([sourceHome, workspaceRoot, secondRepository, fixturePaths.home].map(directory => fs.ensureDir(directory)));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(root);
  });

  const options = () => ({ sourceHome, workspaceRoot, configPath });

  async function seed() {
    await fs.outputJson(path.join(sourceHome, 'settings.json'), {
      env: { API_KEY: 'SOURCE_ENV_MUST_NOT_BE_COPIED' },
      permissions: {
        allow: ['Bash(npm test:*)', 'Bash(git status)', 'Read(./src/**)', 'mcp__docs__search', 'WebFetch(domain:example.com)', 'UnknownTool(secret)'],
        deny: ['Bash(rm:*)', 'Bash(npm test:*)'],
      },
    });
    await fs.outputJson(path.join(workspaceRoot, '.claude', 'settings.json'), { permissions: { allow: ['Bash(git:*)'] } });
    await fs.outputJson(path.join(workspaceRoot, '.claude', 'settings.local.json'), {
      env: { TOKEN: 'PROJECT_ENV_MUST_NOT_BE_COPIED' },
      permissions: { allow: ['Edit(./src/**)'], deny: ['Write(./src/private/**)'] },
    });
    await fs.outputJson(path.join(secondRepository, '.claude', 'settings.json'), {
      permissions: { allow: ['Write(./lib/**)'], deny: ['Bash(git push:*)'] },
    });
    await fs.outputFile(path.join(sourceHome, 'projects', 'encoded-name-is-not-a-path', 'session.jsonl'),
      JSON.stringify({ type: 'user', cwd: secondRepository, message: { content: 'Only the recorded cwd identifies this repo.' } }) + '\n');
    await fs.writeJson(configPath, {
      provider: 'openrouter', retained: { value: true },
      permissions: { allowList: ['run_command:existing*'], denyList: ['shell:already-blocked*'], allowPatterns: [{ kind: 'run_command' }] },
    });
    await fs.outputJson(path.join(workspaceRoot, '.autohand', 'settings.local.json'), {
      version: 1, agent: { keepMe: true }, permissions: { allowList: ['read_file:existing/**'] },
    });
    await fs.writeJson(legacyPath, { importedFrom: 'claude', raw: { env: { TOKEN: 'LEGACY_ENV_MUST_BE_REMOVED' } } });
    await fs.chmod(legacyPath, 0o644);
  }

  async function snapshot(directory = root): Promise<unknown[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const result: unknown[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), stat = await fs.stat(file);
      result.push([path.relative(root, file), stat.mode & 0o777, stat.mtimeMs, entry.isDirectory() ? null : await fs.readFile(file, 'utf8')]);
      if (entry.isDirectory()) result.push(...await snapshot(file));
    }
    return result;
  }

  it('merges translated user and per-repo rules, preserves existing settings and never copies environment data', async () => {
    await seed();
    const result = await new ClaudeImporter(options()).import(['settings']);
    expect(result.errors).toEqual([]);
    expect(result.permissions).toMatchObject({ allow: 7, deny: 4, repositories: 2, skipped: 2, legacySettingsScrubbed: true });

    const user = await fs.readJson(configPath);
    expect(user).toMatchObject({ provider: 'openrouter', retained: { value: true } });
    expect(user.permissions.allowList).toEqual(expect.arrayContaining([
      'run_command:existing*', 'run_command:npm test*', 'shell:npm test*', 'run_command:git status', 'read_file:src/**', 'mcp__docs__search:*',
    ]));
    expect(user.permissions.denyList).toEqual(expect.arrayContaining(['shell:already-blocked*', 'run_command:rm*', 'shell:rm*', 'run_command:npm test*']));
    const first = await fs.readJson(path.join(workspaceRoot, '.autohand', 'settings.local.json'));
    expect(first).toMatchObject({ version: 1, agent: { keepMe: true } });
    expect(first.permissions.allowList).toEqual(expect.arrayContaining(['read_file:existing/**', 'run_command:git*', 'write_file:src/**']));
    expect(first.permissions.denyList).toContain('write_file:src/private/**');
    expect((await fs.readJson(path.join(secondRepository, '.autohand', 'settings.local.json'))).permissions.allowList).toContain('write_file:lib/**');
    expect(JSON.stringify(result.permissions?.mappings)).toContain('no equivalent');
    for (const directory of [fixturePaths.home, path.join(workspaceRoot, '.autohand'), path.join(secondRepository, '.autohand')]) {
      for (const name of await fs.readdir(directory)) {
        const contents = await fs.readFile(path.join(directory, name), 'utf8');
        expect(contents).not.toMatch(/SOURCE_ENV_MUST_NOT_BE_COPIED|PROJECT_ENV_MUST_NOT_BE_COPIED|LEGACY_ENV_MUST_BE_REMOVED/);
      }
    }
    expect(await fs.readJson(legacyPath)).not.toHaveProperty('raw');
    expect((await fs.stat(legacyPath)).mode & 0o777).toBe(0o600);
  });

  it('honours imported deny rules over existing broad user allows and project allows', async () => {
    await seed();
    await new ClaudeImporter(options()).import(['settings']);
    const manager = new PermissionManager({ settings: (await fs.readJson(configPath)).permissions, workspaceRoot });
    await manager.initLocalSettings();
    expect(manager.checkPermission({ tool: 'run_command', command: 'rm notes.txt' }).allowed).toBe(false);
    expect(manager.checkPermission({ tool: 'shell', command: 'rm notes.txt' }).allowed).toBe(false);
    expect(manager.checkPermission({ tool: 'run_command', command: 'npm test --unit' }).allowed).toBe(false);
    expect(manager.checkPermission({ tool: 'run_command', command: 'git status' }).allowed).toBe(true);
    expect(manager.checkPermission({ tool: 'write_file', path: 'src/public.ts' }).allowed).toBe(true);
    expect(manager.checkPermission({ tool: 'write_file', path: 'src/private/token.ts' }).allowed).toBe(false);
  });

  it('prints a dry-run mapping table and cleanup notice without creating or changing any file', async () => {
    await seed();
    const before = await snapshot();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runImport({ ...options(), source: 'claude', categories: ['settings'], dryRun: true });
    expect(await snapshot()).toEqual(before);
    const printed = output.mock.calls.flat().join('\n');
    expect(printed).toContain('Bash(npm test:*)');
    expect(printed).toContain('run_command:npm test*');
    expect(printed).toContain('skipped (no equivalent)');
    expect(printed).toContain('Would scrub');
    expect(printed).not.toMatch(/SOURCE_ENV_MUST_NOT_BE_COPIED|PROJECT_ENV_MUST_NOT_BE_COPIED|LEGACY_ENV_MUST_BE_REMOVED/);
  });

  it('is idempotent across permission writes and legacy cleanup', async () => {
    await seed();
    const importer = new ClaudeImporter(options());
    await importer.import(['settings']);
    const before = await snapshot();
    await importer.import(['settings']);
    expect(await snapshot()).toEqual(before);
  });

  it('discovers project-only permission settings even without a Claude home or hooks', async () => {
    await fs.remove(sourceHome);
    await fs.outputJson(path.join(workspaceRoot, '.claude', 'settings.local.json'), { permissions: { allow: ['Bash(git status)'] } });
    const importer = new ClaudeImporter(options());
    expect(await importer.detect()).toBe(true);
    expect((await importer.scan()).available.get('settings')?.count).toBe(1);
    expect((await importer.import(['settings'])).errors).toEqual([]);
    expect((await fs.readJson(path.join(workspaceRoot, '.autohand', 'settings.local.json'))).permissions.allowList).toContain('run_command:git status');
  });

  it('does not overwrite malformed Autohand configuration or claim translated user rules', async () => {
    await seed();
    await fs.writeFile(configPath, '{not valid JSON');
    const result = await new ClaudeImporter(options()).import(['settings']);
    expect(await fs.readFile(configPath, 'utf8')).toBe('{not valid JSON');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.permissions?.allow).toBe(3);
    expect(result.permissions?.deny).toBe(2);
  });
  it('checks every shell subcommand and never grants unparsed shell syntax from a prefix', async () => {
    await fs.outputJson(path.join(sourceHome, 'settings.json'), { permissions: { allow: ['Bash(npm test:*)', 'Bash(git status)'], deny: ['Bash(rm:*)'] } });
    await new ClaudeImporter(options()).import(['settings']);
    const manager = new PermissionManager({ settings: (await fs.readJson(configPath)).permissions, workspaceRoot });
    expect(manager.checkPermission({ tool: 'run_command', command: 'npm test --unit' }).allowed).toBe(true);
    expect(manager.checkPermission({ tool: 'run_command', command: 'npm test && git status' }).allowed).toBe(false);
    for (const command of ['npm test && rm notes.txt', 'npm test; python3 malicious.py', 'npm test $(rm notes.txt)', 'npm test `rm notes.txt`', 'npm test > secret.txt', 'npm test && "r"m notes.txt', 'npm test && bash -c "rm notes.txt"']) {
      expect(manager.checkPermission({ tool: 'run_command', command }).allowed, command).toBe(false);
    }
  });

  it('skips file patterns whose segment or root semantics have no equivalent', async () => {
    await fs.outputJson(path.join(sourceHome, 'settings.json'), { permissions: { allow: ['Edit(./src/*.ts)', 'Read(secrets/**)', 'Write(/src/**)', 'Edit(./src/**.ts)', 'Read(./src/**/secret.txt)'] } });
    const result = await new ClaudeImporter(options()).import(['settings']);
    expect(result.permissions).toMatchObject({ allow: 0, skipped: 5 });
    expect(await fs.pathExists(configPath)).toBe(false);
  });

  it('refuses a project settings directory that escapes through a symlink', async () => {
    await fs.outputJson(path.join(workspaceRoot, '.claude', 'settings.json'), { permissions: { allow: ['Bash(git status)'] } });
    const outside = path.join(root, 'outside');
    await fs.ensureDir(outside);
    await fs.symlink(outside, path.join(workspaceRoot, '.autohand'));
    const result = await new ClaudeImporter(options()).import(['settings']);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('shows sanitized source errors in dry-run and scrubs legacy data on session-only import', async () => {
    await seed();
    await fs.writeFile(path.join(sourceHome, 'settings.json'), '{"env":{"TOKEN":"SECRET_PARSE_VALUE"}, broken');
    const importer = new ClaudeImporter(options());
    const preview = await importer.previewSettings();
    expect(preview.errors?.length).toBeGreaterThan(0);
    expect(JSON.stringify(preview.errors)).not.toContain('SECRET_PARSE_VALUE');
    const result = await importer.import(['sessions']);
    expect(result.permissions?.legacySettingsScrubbed).toBe(true);
    expect(await fs.readFile(legacyPath, 'utf8')).not.toContain('LEGACY_ENV_MUST_BE_REMOVED');
  });

  it('keeps unsupported shell syntax denied under hard restrictions and checks absolute file denies', async () => {
    await fs.outputJson(path.join(sourceHome, 'settings.json'), { permissions: { allow: ['Bash(git:*)', 'Bash(timeout:*)', 'Read'], deny: ['Bash(rm:*)', 'Read(./secrets.txt)'] } });
    await new ClaudeImporter(options()).import(['settings']);
    const settings = (await fs.readJson(configPath)).permissions;
    const manager = new PermissionManager({ settings, workspaceRoot });
    expect(manager.checkPermission({ tool: 'read_file', path: path.join(workspaceRoot, 'secrets.txt') })).toMatchObject({ allowed: false, reason: 'deny_list' });
    for (const command of ['rm file > out', 'git status && rm file', '"git status"', 'timeout 1 rm file', 'git commit -m "unsafe"', 'npm test %ARGS%', 'find . -delete', 'watch rm file']) {
      expect(manager.checkPermission({ tool: 'run_command', command })).toMatchObject({ allowed: false, reason: 'deny_list' });
    }
    const restricted = new PermissionManager({ settings: { mode: 'restricted', allowList: ['run_command:git*'] } });
    expect(restricted.checkPermission({ tool: 'run_command', command: 'git status > out' })).toMatchObject({ allowed: false, reason: 'mode_restricted' });
  });

  it('preserves Claude word boundaries and case without changing pre-existing Autohand rules', async () => {
    await fs.outputJson(path.join(sourceHome, 'settings.json'), { permissions: { allow: ['Bash(git:*)', 'Read(./src/**)'], deny: ['Read(./secret.txt)'] } });
    await new ClaudeImporter(options()).import(['settings']);
    const manager = new PermissionManager({ settings: (await fs.readJson(configPath)).permissions, workspaceRoot });
    expect(manager.checkPermission({ tool: 'run_command', command: 'git status' }).allowed).toBe(true);
    expect(manager.checkPermission({ tool: 'run_command', command: 'gitfoo' }).allowed).toBe(false);
    expect(manager.checkPermission({ tool: 'run_command', command: 'GIT status' }).allowed).toBe(false);
    expect(manager.checkPermission({ tool: 'read_file', path: path.join(workspaceRoot, 'src/ok.txt') }).allowed).toBe(true);
    expect(manager.checkPermission({ tool: 'read_file', path: path.join(workspaceRoot, 'SRC/ok.txt') }).allowed).toBe(false);
    expect(manager.checkPermission({ tool: 'read_file', path: path.join(workspaceRoot, 'secret.txt') })).toMatchObject({ allowed: false, reason: 'deny_list' });
    const previous = new PermissionManager({ settings: { allowList: ['run_command:git*'] }, workspaceRoot });
    expect(previous.checkPermission({ tool: 'run_command', command: 'gitfoo' }).allowed).toBe(true);
  });

  it('keeps global and project rule identity through actual config loading, before async reload', async () => {
    await seed();
    await new ClaudeImporter(options()).import(['settings']);
    const config = await fs.readJson(configPath);
    config.permissions.denyList.push('run_command:git*');
    await fs.writeJson(configPath, config);
    await fs.outputJson(path.join(workspaceRoot, '.claude', 'settings.local.json'), { permissions: { deny: ['Bash(git:*)', 'Read(./**)'] } });
    await new ClaudeImporter(options()).import(['settings']);
    const workspaceTrustStorePath = path.join(root, 'trust.json');
    const loadOptions = { initializeTheme: false, workspaceTrustStorePath };
    const initial = await loadConfig(configPath, workspaceRoot, loadOptions);
    if (initial.workspaceTrust && !initial.workspaceTrust.trusted) await trustWorkspace(workspaceRoot, initial.workspaceTrust.fingerprint, workspaceTrustStorePath);
    const loaded = await loadConfig(configPath, workspaceRoot, loadOptions);
    const manager = new PermissionManager({ settings: loaded.permissions, workspaceRoot });
    expect(manager.checkPermission({ tool: 'run_command', command: 'rm notes.txt' })).toMatchObject({ allowed: false, reason: 'deny_list' });
    expect(manager.checkPermission({ tool: 'run_command', command: 'gitfoo' })).toMatchObject({ allowed: false, reason: 'deny_list' });
    expect(manager.checkPermission({ tool: 'read_file', path: path.join(workspaceRoot, 'anything.txt') })).toMatchObject({ allowed: false, reason: 'project_deny_list' });
    await manager.initLocalSettings();
    expect(manager.checkPermission({ tool: 'run_command', command: 'gitfoo' })).toMatchObject({ allowed: false, reason: 'deny_list' });
    await saveConfig(loaded);
    expect((await fs.readJson(configPath)).permissions).not.toHaveProperty('workspaceScopes');
    const other = await loadConfig(configPath, secondRepository, loadOptions);
    const otherManager = new PermissionManager({ settings: other.permissions, workspaceRoot: secondRepository });
    expect(otherManager.checkPermission({ tool: 'read_file', path: path.join(secondRepository, 'anything.txt') }).reason).not.toBe('project_deny_list');
  });

  it('checks both requested and resolved paths for existing and new files behind repository symlinks', async () => {
    await fs.ensureDir(path.join(workspaceRoot, 'public'));
    await fs.ensureDir(path.join(workspaceRoot, 'secrets'));
    await fs.writeFile(path.join(workspaceRoot, 'secrets', 'token.txt'), 'fixture');
    await fs.symlink('../secrets', path.join(workspaceRoot, 'public', 'link'));
    await fs.outputJson(path.join(sourceHome, 'settings.json'), { permissions: { allow: ['Read(./public/**)', 'Write(./public/**)'], deny: ['Read(./secrets/**)', 'Write(./secrets/**)'] } });
    await new ClaudeImporter(options()).import(['settings']);
    const manager = new PermissionManager({ settings: (await fs.readJson(configPath)).permissions, workspaceRoot });
    for (const tool of ['read_file', 'write_file']) {
      expect(manager.checkPermission({ tool, path: 'public/link/token.txt' })).toMatchObject({ allowed: false, reason: 'deny_list' });
      expect(manager.checkPermission({ tool, path: 'public/link/new.txt' })).toMatchObject({ allowed: false, reason: 'deny_list' });
      expect(manager.checkPermission({ tool, path: 'public/safe.txt' }).allowed).toBe(true);
    }
  });

  it('does not retain source metadata after removing, saving and re-adding an ordinary rule', async () => {
    await fs.outputJson(path.join(sourceHome, 'settings.json'), { permissions: { allow: ['Bash(npm test:*)'], deny: ['Bash(git:*)'] } });
    await new ClaudeImporter(options()).import(['settings']);
    const manager = new PermissionManager({ settings: (await fs.readJson(configPath)).permissions, workspaceRoot,
      onPersist: async permissions => { await fs.writeJson(configPath, { permissions }); } });
    await manager.removeFromAllowList('run_command:npm test*');
    await manager.removeFromDenyList('run_command:git*');
    const settings = (await fs.readJson(configPath)).permissions;
    expect(settings.importedClaudeRules.some((rule: { pattern: string }) => rule.pattern === 'run_command:git*' || rule.pattern === 'run_command:npm test*')).toBe(false);
    const reloaded = new PermissionManager({ settings, workspaceRoot });
    reloaded.addToAllowList('run_command:npm test*');
    reloaded.addToDenyList('run_command:git*');
    expect(reloaded.checkPermission({ tool: 'run_command', command: 'gitfoo' })).toMatchObject({ allowed: false, reason: 'deny_list' });
    expect(reloaded.checkPermission({ tool: 'run_command', command: 'npm testfoo' }).allowed).toBe(true);
  });

  it('ignores forged saved runtime scopes in a minimal configuration', async () => {
    await fs.writeJson(configPath, { permissions: { workspaceScopes: [{ denyList: ['read_file:*'] }] } });
    const loaded = await loadConfig(configPath, workspaceRoot, { initializeTheme: false, workspaceTrustStorePath: path.join(root, 'trust.json') });
    expect(loaded.permissions).not.toHaveProperty('workspaceScopes');
  });

});
