/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';

const {
  parsePermissionToolInputs,
  applyPermissionPolicyUpdates,
} = await import('../../src/permissions/cliPolicyMutation.js');

describe('permission CLI policy mutation helpers', () => {
  it('parses repeated list inputs and YAML arrays into tool patterns', () => {
    const parsed = parsePermissionToolInputs([
      'run_command(git:*)',
      '- read_file(src/**)\n- mcp__filesystem__write_file(src/**)',
    ]);

    expect(parsed).toEqual([
      { kind: 'run_command', argument: 'git:*' },
      { kind: 'read_file', argument: 'src/**' },
      { kind: 'mcp__filesystem__write_file', argument: 'src/**' },
    ]);
  });

  it('merges policy updates into the existing permission settings', () => {
    const updated = applyPermissionPolicyUpdates(
      {
        availableTools: [{ kind: 'read_file' }],
        allowPatterns: [{ kind: 'read_file', argument: 'src/**' }],
      },
      {
        availableTools: [
          { kind: 'read_file' },
          { kind: 'run_command', argument: 'git:*' },
        ],
        denyPatterns: [{ kind: 'run_command', argument: 'npm publish' }],
        excludedTools: [{ kind: 'delete_path' }],
      },
    );

    expect(updated.availableTools).toEqual([
      { kind: 'read_file' },
      { kind: 'run_command', argument: 'git:*' },
    ]);
    expect(updated.allowPatterns).toEqual([{ kind: 'read_file', argument: 'src/**' }]);
    expect(updated.denyPatterns).toEqual([{ kind: 'run_command', argument: 'npm publish' }]);
    expect(updated.excludedTools).toEqual([{ kind: 'delete_path' }]);
  });
});
