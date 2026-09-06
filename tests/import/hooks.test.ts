import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HookImportService, parseImportedHooks } from '../../src/import/HookImportService.js';
import { HookManager } from '../../src/core/HookManager.js';
import { ImporterRegistry } from '../../src/import/registry.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.remove(root))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hook-import-'));
  roots.push(root);
  const home = path.join(root, 'source');
  const workspaceRoot = path.join(root, 'project');
  await fs.ensureDir(home);
  await fs.ensureDir(workspaceRoot);
  return { root, home, workspaceRoot, configPath: path.join(root, 'autohand.json') };
}
const command = { type: 'command', command: 'node guard.cjs', timeout: 2.5 };

describe('foreign hook imports', () => {
  it('translates nested Claude commands, keeps provenance and reports unsupported entries', () => {
    const result = parseImportedHooks('claude', { hooks: {
      PreToolUse: [{ matcher: '^Bash$', hooks: [command, { type: 'prompt', prompt: 'check' }] }],
      Stop: [{ hooks: [command] }],
      UnknownFutureEvent: [{ hooks: [command] }],
    } }, { path: '/source/settings.json' }, '/project');
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]).toMatchObject({ event: 'pre-tool', enabled: false, timeout: 2500,
      importedFrom: { source: 'claude', event: 'PreToolUse', configPath: '/source/settings.json' } });
    expect(result.skipped).toBe(3);
    expect(Object.keys(result.skipReasons).join(' ')).toMatch(/prompt.*Stop.*UnknownFutureEvent/);
  });

  it('imports Codex JSON and nested TOML, preserving multiline commands and deduplicating repeat imports', async () => {
    const f = await fixture();
    await fs.writeJson(path.join(f.home, 'hooks.json'), { hooks: { UserPromptSubmit: [{ hooks: [command] }] } });
    await fs.writeFile(path.join(f.home, 'config.toml'), `model = "moa"
[[hooks.PreToolUse]]
matcher = "Bash"
[[hooks.PreToolUse.hooks]]
type = "command"
command = '''echo first
echo second'''
timeout = 3
`);
    await fs.writeJson(f.configPath, { provider: 'example', hooks: { enabled: false, hooks: [{ event: 'stop', command: 'echo existing' }] } });
    const service = new HookImportService('codex', f.home, f);
    expect((await service.import()).stats.success).toBe(2);
    const saved = await fs.readJson(f.configPath);
    expect(saved.provider).toBe('example');
    expect(saved.hooks.enabled).toBe(false);
    expect(saved.hooks.hooks).toHaveLength(3);
    expect(saved.hooks.hooks[2].command).toBe('echo first\necho second');
    expect((await service.import()).stats).toMatchObject({ success: 0, skipped: 2 });
  });

  it('discovers legacy Codex notify commands and reports why they need manual porting', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.home, 'config.toml'), 'notify = ["node", "notify.cjs"]\n');
    const service = new HookImportService('codex', f.home, f);
    expect(await service.scan()).toBe(1);
    expect((await service.import()).stats).toMatchObject({
      success: 0, skipped: 1,
      skipReasons: { 'notify: legacy notification commands receive JSON in argv and require manual porting': 1 },
    });
    expect(await fs.pathExists(f.configPath)).toBe(false);
  });

  it('registers Grok and detects project-only hooks for all four sources', async () => {
    const f = await fixture();
    for (const source of ['claude', 'codex', 'cursor', 'grok'] as const) {
      const file = source === 'claude' ? 'settings.json' : source === 'grok' ? 'hooks/test.json' : 'hooks.json';
      const definition = source === 'cursor' ? { hooks: { preToolUse: [command] } } : { hooks: { PreToolUse: [{ hooks: [command] }] } };
      await fs.outputJson(path.join(f.workspaceRoot, `.${source}`, file), definition);
      const importer = new ImporterRegistry({ ...f, sourceHome: path.join(f.root, 'missing') }).get(source)!;
      expect(await importer.detect()).toBe(true);
      expect((await importer.scan()).available.has('hooks')).toBe(true);
      expect((await importer.import(['hooks'])).imported.get('hooks')?.success).toBe(1);
    }
  });

  it('preserves project scope and Cursor user command working directories', async () => {
    const f = await fixture();
    await fs.outputJson(path.join(f.workspaceRoot, '.cursor/hooks.json'), { hooks: { beforeShellExecution: [command] } });
    await fs.writeJson(path.join(f.home, 'hooks.json'), { hooks: { beforeShellExecution: [command] } });
    await new HookImportService('cursor', f.home, f).import();
    const hooks = (await fs.readJson(f.configPath)).hooks.hooks;
    expect(hooks[0].importedFrom.workingDirectory).toBe(f.home);
    expect(hooks[1].importedFrom.workspaceRoot).toBe(f.workspaceRoot);
  });

  it('does not overwrite malformed target configuration or claim a successful import', async () => {
    const f = await fixture();
    await fs.writeJson(path.join(f.home, 'settings.json'), { hooks: { PreToolUse: [{ hooks: [command] }] } });
    await fs.writeFile(f.configPath, '{broken');
    const result = await new HookImportService('claude', f.home, f).import();
    expect(result.stats).toMatchObject({ success: 0, failed: 1 });
    expect(await fs.readFile(f.configPath, 'utf8')).toBe('{broken');
  });

  it('updates an active HookManager and rolls back if persistence fails', async () => {
    const f = await fixture();
    await fs.writeJson(path.join(f.home, 'settings.json'), { hooks: { PreToolUse: [{ hooks: [command] }] } });
    const hookManager = new HookManager({ workspaceRoot: f.workspaceRoot, onPersist: async () => { throw new Error('disk full'); } });
    const result = await new HookImportService('claude', f.home, { ...f, hookManager }).import();
    expect(result.stats).toMatchObject({ success: 0, failed: 1 });
    expect(hookManager.getHooks()).toHaveLength(0);
  });
});

describe('imported command execution', () => {
  it.each(['claude', 'codex', 'cursor', 'grok'] as const)('adapts %s tool names, stdin and deny responses', async source => {
    const f = await fixture();
    const script = path.join(f.workspaceRoot, 'guard.cjs');
    await fs.writeFile(script, `let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => {
      const value=JSON.parse(input); require('fs').writeFileSync('input.json', JSON.stringify(value));
      console.log(JSON.stringify(${source === 'grok' ? `{decision:'deny',reason:'blocked'}` : source === 'cursor' ? `{permission:'deny',user_message:'blocked'}` : `{hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'blocked'}}`}));
    });`);
    const event = source === 'cursor' ? 'preToolUse' : 'PreToolUse';
    const handler = { command: 'node guard.cjs', type: 'command' };
    const data = { hooks: { [event]: source === 'cursor' ? [{ ...handler, matcher: '^Shell$' }] : [{ matcher: source === 'grok' ? undefined : '^Bash$', hooks: [handler] }] } };
    const hook = parseImportedHooks(source, data, { path: '/source/hooks.json' }, f.workspaceRoot).hooks[0];
    const manager = new HookManager({ workspaceRoot: f.workspaceRoot, settings: { hooks: [{ ...hook, enabled: true }] } });
    const result = await manager.executeHooks('pre-tool', { tool: 'run_command', args: { command: 'echo', args: ['hello world'] }, sessionId: 'test-session' });
    expect(result).toHaveLength(1);
    expect(result[0].response).toMatchObject({ decision: 'deny', reason: 'blocked' });
    const input = await fs.readJson(path.join(f.workspaceRoot, 'input.json'));
    expect(source === 'grok' ? input.hookEventName : input.hook_event_name).toBe(event);
    expect(source === 'grok' ? input.toolInput.command : input.tool_input.command).toBe("echo 'hello world'");
    expect(source === 'grok' ? input.sessionId : input.session_id ?? input.conversation_id).toBe('test-session');
  });

  it('filters Cursor shell commands and does not fire project hooks in another workspace', async () => {
    const f = await fixture();
    const hook = parseImportedHooks('cursor', { hooks: { beforeShellExecution: [{ command: 'echo ran', matcher: 'npm test' }] } }, { path: '/project/hooks.json', workspaceRoot: f.workspaceRoot }, f.workspaceRoot).hooks[0];
    const manager = new HookManager({ workspaceRoot: f.workspaceRoot, settings: { hooks: [{ ...hook, enabled: true }] } });
    expect(await manager.executeHooks('pre-tool', { tool: 'read_file', args: { path: 'npm test' } })).toEqual([]);
    expect(await manager.executeHooks('pre-tool', { tool: 'run_command', args: { command: 'echo ok' } })).toEqual([]);
    expect(await manager.executeHooks('pre-tool', { tool: 'shell', args: { command: 'npm test' } })).toHaveLength(1);
    manager.setWorkspaceRoot(f.root);
    expect(await manager.executeHooks('pre-tool', { tool: 'shell', args: { command: 'npm test' } })).toEqual([]);
  });

  it('separates Claude success and failure events while Codex PostToolUse observes both', async () => {
    const f = await fixture();
    for (const source of ['claude', 'codex'] as const) {
      const hook = parseImportedHooks(source, { hooks: { PostToolUse: [{ hooks: [{ command: 'echo observed' }] }] } }, { path: '/hooks.json' }, f.workspaceRoot).hooks[0];
      const manager = new HookManager({ workspaceRoot: f.workspaceRoot, settings: { hooks: [{ ...hook, enabled: true }] } });
      expect(await manager.executeHooks('post-tool', { tool: 'shell', success: false })).toHaveLength(source === 'codex' ? 1 : 0);
      expect(await manager.executeHooks('post-tool', { tool: 'shell', success: true })).toHaveLength(1);
    }
  });
});

describe('import compatibility boundaries', () => {
  it('does not interpret object prototype keys as lifecycle events', () => {
    const result = parseImportedHooks('claude', JSON.parse('{"hooks":{"constructor":[{"hooks":[{"command":"echo unsafe"}]}]}}'), { path: '/hooks.json' }, '/project');
    expect(result.hooks).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it('translates permission decisions and file rewrites without retaining stale contents', async () => {
    const f = await fixture();
    const cases = [
      { event: 'PermissionRequest', response: { hookSpecificOutput: { decision: { behavior: 'deny', message: 'DENIED' } } }, expected: { decision: 'deny', reason: 'DENIED' } },
      { event: 'PreToolUse', response: { hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { file_path: 'new.txt', content: 'new text' } } }, expected: { updatedInput: { path: 'new.txt', content: 'new text', contents: 'new text' } } },
    ];
    for (const entry of cases) {
      const command = `printf '%s' '${JSON.stringify(entry.response)}'`;
      const hook = parseImportedHooks('claude', { hooks: { [entry.event]: [{ hooks: [{ command }] }] } }, { path: '/hooks.json' }, f.workspaceRoot).hooks[0];
      expect(hook).toBeDefined();
      const manager = new HookManager({ workspaceRoot: f.workspaceRoot, settings: { hooks: [{ ...hook, enabled: true }] } });
      const results = await manager.executeHooks(hook.event, { tool: 'write_file', args: { path: 'old.txt', contents: 'old text' } });
      expect(results[0].response).toMatchObject(entry.expected);
    }
  });

  it.each(['yaml', 'toml'])('persists hooks in the selected %s config without touching a JSON config', async extension => {
    const f = await fixture();
    const configPath = path.join(f.root, `config.${extension}`);
    await fs.writeFile(configPath, extension === 'yaml' ? 'provider: custom\nhooks:\n  enabled: false\n' : 'provider = "custom"\n[hooks]\nenabled = false\n');
    await fs.writeJson(path.join(f.home, 'hooks.json'), { hooks: { preToolUse: [{ command: 'echo check' }] } });
    expect((await new HookImportService('cursor', f.home, { ...f, configPath }).import()).stats.success).toBe(1);
    expect(await fs.readFile(configPath, 'utf8')).toContain('custom');
    expect(await fs.pathExists(f.configPath)).toBe(false);
  });
});

describe('Grok passive and blocking semantics', () => {
  it('keeps prompt hooks passive even when they exit with code 2', async () => {
    const f = await fixture();
    const hook = parseImportedHooks('grok', { hooks: { UserPromptSubmit: [{ hooks: [{ command: 'exit 2' }] }] } }, { path: '/hooks.json' }, f.workspaceRoot).hooks[0];
    const manager = new HookManager({ workspaceRoot: f.workspaceRoot, settings: { hooks: [{ ...hook, enabled: true }] } });
    expect((await manager.executeHooks('pre-prompt', {}))[0].blockingError).toBe(false);
  });
  it('does not turn a Grok allow response into a permission override', async () => {
    const f = await fixture();
    const hook = parseImportedHooks('grok', { hooks: { PreToolUse: [{ hooks: [{ command: `printf '%s' '{"decision":"allow"}'` }] }] } }, { path: '/hooks.json' }, f.workspaceRoot).hooks[0];
    const manager = new HookManager({ workspaceRoot: f.workspaceRoot, settings: { hooks: [{ ...hook, enabled: true }] } });
    expect((await manager.executeHooks('pre-tool', { tool: 'shell' }))[0].response?.decision).toBeUndefined();
  });
});
