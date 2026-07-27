/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

interface PackageManifest {
  bin: Record<string, string>;
}

describe('CLI command aliases', () => {
  it('publishes autohand with autohand-code and agent package aliases', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf-8'),
    ) as PackageManifest;

    expect(manifest.bin).toEqual({
      autohand: 'dist/index.js',
      'autohand-code': 'dist/index.js',
      agent: 'dist/index.js',
    });
  });

  it('installs the compatibility alias on Unix systems', () => {
    const installer = readFileSync(join(ROOT, 'install.sh'), 'utf-8');

    expect(installer).toContain('BINARY_NAME="autohand"');
    expect(installer).toContain('COMPAT_BINARY_NAME="autohand-code"');
    expect(installer).toContain('AGENT_ALIAS_NAME="agent"');
    expect(installer).toContain(
      'install_symlink "$BINARY_NAME" "$_dir/$COMPAT_BINARY_NAME"',
    );
    expect(installer).toContain(
      'install_symlink "$BINARY_NAME" "$_dir/$AGENT_ALIAS_NAME"',
    );
  });

  it('installs the compatibility alias for local development builds', () => {
    const installer = readFileSync(join(ROOT, 'install-local.sh'), 'utf-8');

    expect(installer).toContain(
      'ALIAS_PATH="$(dirname "$INSTALL_PATH")/autohand-code"',
    );
    expect(installer).toContain(
      'AGENT_ALIAS_PATH="$(dirname "$INSTALL_PATH")/agent"',
    );
    expect(installer).toContain(
      'ln -sfn "$(basename "$INSTALL_PATH")" "$ALIAS_PATH"',
    );
    expect(installer).toContain(
      'ln -sfn "$(basename "$INSTALL_PATH")" "$AGENT_ALIAS_PATH"',
    );
  });

  it('installs the compatibility alias on Windows systems', () => {
    const installer = readFileSync(join(ROOT, 'install.ps1'), 'utf-8');

    expect(installer).toContain('$BINARY_NAME = "autohand.exe"');
    expect(installer).toContain('$COMPAT_BINARY_NAME = "autohand-code.cmd"');
    expect(installer).toContain('$AGENT_ALIAS_NAME = "agent.cmd"');
    expect(installer).toContain(
      '$agentCollisionNames = @("agent.com", "agent.exe", "agent.bat", "agent.cmd")',
    );
    expect(installer).toContain(
      'Remove-Item -Path $agentCollisionPath -Force -Recurse',
    );
    expect(installer).toContain('"%~dp0autohand.exe" %*');
    expect(installer).toContain(
      '[System.IO.File]::WriteAllLines($agentAliasPath, $compatShim, [System.Text.Encoding]::ASCII)',
    );
  });
});
