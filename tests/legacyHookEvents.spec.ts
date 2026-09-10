/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_HOOK_EVENTS,
  legacyHookMatches,
  normalizeHooksSettings,
  renderHookCommandTemplate,
  resolveHookEvents,
} from '../src/core/legacyHookEvents.js';
import type { HookContext } from '../src/core/HookManager.js';

const base = { workspace: '/ws' } as const;

describe('legacy hook event names', () => {
  it('maps every previously documented name onto real lifecycle events', () => {
    expect(resolveHookEvents('on_session_start')).toEqual(['session-start']);
    expect(resolveHookEvents('on_session_resume')).toEqual(['session-start']);
    expect(resolveHookEvents('before_tool_call')).toEqual(['pre-tool']);
    expect(resolveHookEvents('on_tool_error')).toEqual(['post-tool']);
    expect(resolveHookEvents('on_automode_stop')).toEqual(['automode:complete', 'automode:cancel', 'automode:error']);
    expect(resolveHookEvents('pre-tool')).toEqual(['pre-tool']);
    expect(resolveHookEvents('post-response')).toEqual(['stop']);
    expect(LEGACY_HOOK_EVENTS).toHaveLength(23);
  });

  it.each([
    ['on_session_resume', { event: 'session-start', sessionType: 'resume' }, true],
    ['on_session_resume', { event: 'session-start', sessionType: 'startup' }, false],
    ['on_tool_error', { event: 'post-tool', tool: 'write_file', success: false }, true],
    ['on_tool_error', { event: 'post-tool', tool: 'write_file', success: true }, false],
    ['on_file_create', { event: 'file-modified', path: 'a.ts', changeType: 'create' }, true],
    ['on_file_delete', { event: 'file-modified', path: 'a.ts', changeType: 'modify' }, false],
    ['on_file_change', { event: 'file-modified', path: 'a.ts', changeType: 'delete' }, true],
    ['on_file_read', { event: 'post-tool', tool: 'read_file', success: true }, true],
    ['on_file_read', { event: 'post-tool', tool: 'write_file', success: true }, false],
    ['before_command', { event: 'pre-tool', tool: 'shell' }, true],
    ['before_command', { event: 'pre-tool', tool: 'read_file' }, false],
    ['after_command', { event: 'post-tool', tool: 'run_command' }, true],
    ['on_permission_denied', { event: 'permission-denied', tool: 'shell' }, true],
    ['before_tool_call', { event: 'pre-tool', tool: 'read_file' }, true],
  ] as const)('%s only fires for the matching context %j', (name, context, expected) => {
    expect(legacyHookMatches(name, { ...base, ...context } as HookContext)).toBe(expected);
  });
});

describe('hook command templates', () => {
  it('substitutes documented variables from the hook context', () => {
    const context = {
      ...base, event: 'file-modified', path: 'src/app.ts', changeType: 'modify', sessionId: 's-1',
      tool: 'write_file', duration: 12, output: 'ok', tokensUsed: 42, error: 'boom',
    } as HookContext;
    const command = renderHookCommandTemplate(
      'eslint {{file}} --fix; echo {{action}} {{tool}} {{duration}} {{session_id}} {{project}} {{cwd}} {{result}} {{tokens}} {{error}}',
      context,
    );
    expect(command).toBe('eslint src/app.ts --fix; echo modify write_file 12 s-1 /ws /ws ok 42 boom');
  });

  it('shell-quotes values that are not plain words and blanks unknown variables', () => {
    const context = { ...base, event: 'pre-tool', tool: 'shell', args: { command: 'rm -rf "tmp dir"' }, path: 'my file.ts' } as HookContext;
    const command = renderHookCommandTemplate('echo {{command}} {{file}} {{args}} {{nope}}', context);
    expect(command).toBe(`echo 'rm -rf "tmp dir"' 'my file.ts' '{"command":"rm -rf \\"tmp dir\\""}' `);
  });

  it('renders an ISO timestamp and leaves commands without templates untouched', () => {
    expect(renderHookCommandTemplate('echo {{timestamp}}', { ...base, event: 'stop' } as HookContext))
      .toMatch(/^echo \d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(renderHookCommandTemplate('echo "$HOOK_TOOL"', { ...base, event: 'stop' } as HookContext)).toBe('echo "$HOOK_TOOL"');
  });
});

describe('legacy hooks settings shape', () => {
  it('turns event-keyed command lists into hook definitions alongside the array form', () => {
    const settings = normalizeHooksSettings({
      enabled: true,
      hooks: [{ event: 'pre-tool', command: 'echo new' }],
      on_file_change: ['eslint {{file}} --fix', { command: 'prettier --write {{file}}', timeout: 1000, async: true }],
      on_session_end: 'notify-send done',
      bogus: 42,
    });
    expect(settings).toEqual({
      enabled: true,
      hooks: [
        { event: 'pre-tool', command: 'echo new' },
        { event: 'on_file_change', command: 'eslint {{file}} --fix' },
        { event: 'on_file_change', command: 'prettier --write {{file}}', timeout: 1000, async: true },
        { event: 'on_session_end', command: 'notify-send done' },
      ],
    });
  });

  it('returns array-form settings unchanged and tolerates missing settings', () => {
    const plain = { enabled: false, hooks: [{ event: 'stop', command: 'true' }] };
    expect(normalizeHooksSettings(plain)).toBe(plain);
    expect(normalizeHooksSettings(undefined)).toBeUndefined();
  });
});
