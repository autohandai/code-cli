import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalPermissionEpoch } from '../../../src/core/agent/GoalSkillRuntime.js';
import { PermissionManager } from '../../../src/permissions/PermissionManager.js';
import type { AgentRuntime, CLIOptions } from '../../../src/types.js';

describe('goal permission fingerprint', () => {
  let root: string;
  let runtime: Pick<AgentRuntime, 'config' | 'options'>;
  let permissions: PermissionManager;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-permission-epoch-'));
    runtime = { config: { configPath: path.join(root, 'config.json'), permissions: { mode: 'interactive', allowList: ['write_file:src/**'], denyList: ['delete_path:*'] } }, options: {} };
    permissions = new PermissionManager(runtime.config.permissions);
  });
  afterEach(async () => { await fs.remove(root); });

  it('stores only a compact digest and remains stable for equivalent normalized policy in another process', () => {
    const first = createGoalPermissionEpoch(runtime, permissions);
    const second = new PermissionManager({ denyList: ['delete_path:*'], allowList: ['write_file:src/**'], mode: 'interactive' });
    expect(createGoalPermissionEpoch({ ...runtime, options: { yes: false, restricted: false, dryRun: false } }, second)).toBe(first);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/); expect(first).not.toContain('write_file');
  });

  it('tracks effective mode independently of the saved configuration', () => {
    const before = createGoalPermissionEpoch(runtime, permissions); permissions.setMode('restricted');
    expect(createGoalPermissionEpoch(runtime, permissions)).not.toBe(before);
    expect(runtime.config.permissions?.mode).toBe('interactive');
  });

  it.each<[keyof CLIOptions, unknown]>([['yes', true], ['dryRun', true], ['restricted', true], ['unrestricted', true], ['yolo', 'allow:read_file'], ['allowedTools', ['read_file']], ['disallowedTools', ['write_file']], ['addDir', ['/authorized/extra']]])('tracks current run authorization setting %s', (name, value) => {
    const before = createGoalPermissionEpoch(runtime, permissions); Reflect.set(runtime.options, name, value);
    expect(createGoalPermissionEpoch(runtime, permissions)).not.toBe(before);
  });

  it('includes effective local rules, temporary scopes, and review restrictions', async () => {
    const before = createGoalPermissionEpoch(runtime, permissions);
    await fs.outputJson(path.join(root, '.autohand/settings.local.json'), { permissions: { excludedTools: ['write_file'], rules: [{ tool: 'read_file', action: 'deny', pattern: 'private/**' }] } });
    const local = new PermissionManager({ settings: runtime.config.permissions, workspaceRoot: root }); await local.initLocalSettings();
    expect(createGoalPermissionEpoch(runtime, local)).not.toBe(before);
    const effective = local.getEffectiveSettings(); effective.excludedTools?.push('read_file');
    expect(local.getEffectiveSettings().excludedTools).toEqual(['write_file']);
    const localEpoch = createGoalPermissionEpoch(runtime, local); const release = local.beginReadOnlyReview();
    expect(createGoalPermissionEpoch(runtime, local)).not.toBe(localEpoch); release();
    const releaseScope = local.addRunToolScope({ allowed: ['read_file'], denied: [] });
    expect(createGoalPermissionEpoch(runtime, local)).not.toBe(localEpoch); releaseScope();
    expect(createGoalPermissionEpoch(runtime, local)).toBe(localEpoch);
  });
});
