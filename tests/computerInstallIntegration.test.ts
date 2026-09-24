/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('computer control installation integration', () => {
  it('installs native computer control and the branded macOS permission host after Autohand', async () => {
    const script = await readFile('install.sh', 'utf8');
    expect(script).toContain('install_computer_control');
    expect(script).toContain('computer install --non-interactive');
    expect(script).not.toContain('computer install --non-interactive --bin-dir');
    expect(script).toContain('Computer control');
    expect(script).toContain('Autohand Computer Use.app');
    expect(script).toContain('AUTOHAND_COMPUTER_USE_APP_SOURCE');
    expect(script).toContain('Autohand Computer Use is ready');
  });

  it('installs computer use into its Autohand-owned Windows directory', async () => {
    const script = await readFile('install.ps1', 'utf8');
    expect(script).toContain('Install-ComputerControl');
    expect(script).toContain('computer install --non-interactive');
    expect(script).not.toContain('computer install --non-interactive --bin-dir');
    expect(script).toContain('Computer control');
  });

  it('includes computer control in published npm installation', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
      files: string[];
      scripts: { postinstall: string };
    };
    expect(manifest.scripts.postinstall).toContain('computer install --non-interactive');
    expect(manifest.files).toContain('docs/computer-control.md');
    expect(manifest.files).toContain('native/macos/prebuilt');
  });
});
