import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureShellExecution, getShellExecutionProfile } from '../src/utils/shellExecution.js';
import { executeShellCommandAsync, executeStreamingShellCommand } from '../src/ui/shellCommand.js';
import { runCommand } from '../src/actions/command.js';

afterEach(() => { configureShellExecution(undefined); vi.unstubAllEnvs(); });

describe.skipIf(process.platform !== 'win32')('native Windows shell compatibility', () => {
  it('executes Git Bash commands using the native Bash executable', async () => {
    vi.stubEnv('MSYSTEM', 'MINGW64');
    vi.stubEnv('SHELL', '/usr/bin/bash');
    expect(getShellExecutionProfile().dialect).toBe('posix');
    const result = await executeShellCommandAsync('printf "%s" "BASH_NATIVE_OK"');
    expect(result.success, result.error).toBe(true);
    expect(result.output).toContain('BASH_NATIVE_OK');
  });

  it.each([
    ['cmd.exe', 'echo CMD_NATIVE_OK', 'CMD_NATIVE_OK'],
    ['pwsh.exe', 'Write-Output "POWERSHELL_NATIVE_OK"', 'POWERSHELL_NATIVE_OK'],
  ])('uses the explicitly configured %s for both command paths', async (executable, command, expected) => {
    configureShellExecution({ executable });
    const tool = await runCommand(command, [], process.cwd(), { shell: true, timeout: 15000 });
    expect(tool.code, tool.stderr).toBe(0);
    expect(tool.stdout).toContain(expected);
    const foreground = await executeShellCommandAsync(command, process.cwd(), 15000);
    expect(foreground.success, foreground.error).toBe(true);
    expect(foreground.output).toContain(expected);
  });

  it('preserves CMD quoting of executable paths and JavaScript strings in all command paths', async () => {
    configureShellExecution({ executable: 'cmd.exe' });
    const command = `"${process.execPath}" -e "process.stdout.write('QUOTED_NATIVE_OK')"`;
    const tool = await runCommand(command, [], process.cwd(), { shell: true, timeout: 15000 });
    expect(tool.stdout, tool.stderr).toContain('QUOTED_NATIVE_OK');
    const foreground = await executeShellCommandAsync(command);
    expect(foreground.output, foreground.error).toContain('QUOTED_NATIVE_OK');
    const streaming = await executeStreamingShellCommand(command, process.cwd(), { preferPty: true });
    expect(streaming.output, streaming.error).toContain('QUOTED_NATIVE_OK');
  });

  it('hands a Git Bash sh installation to real PowerShell without losing spaced paths or options', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autohand-git-bash-'));
    try {
      const unixPath = (value: string) => execFileSync('cygpath.exe', ['-u', value], { encoding: 'utf8' }).trim();
      const bin = path.join(directory, 'mock bin');
      await mkdir(bin);
      const stub = path.join(directory, 'stub.ps1');
      const record = path.join(directory, 'handoff.json');
      const installDir = path.join(directory, 'install with spaces');
      await writeFile(stub, [
        'param([switch]$Alpha, [switch]$Fresh, [switch]$NoZit, [string]$Version, [string]$InstallDir)',
        '@{ alpha=$Alpha.IsPresent; fresh=$Fresh.IsPresent; noZit=$NoZit.IsPresent; version=$Version; installDir=$InstallDir } | ConvertTo-Json | Set-Content -LiteralPath $env:AUTOHAND_HANDOFF_RECORD',
      ].join('\n'));
      await writeFile(path.join(bin, 'curl'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; cp "$AUTOHAND_HANDOFF_STUB" "$1"; exit 0; fi; shift; done; exit 1\n', { mode: 0o755 });
      const result = spawnSync('bash.exe', ['-lc', 'export PATH="$AUTOHAND_MOCK_BIN:$PATH"; sh "$AUTOHAND_INSTALL_SCRIPT" --alpha --fresh --no-zit'], {
        encoding: 'utf8', timeout: 30000,
        env: { ...process.env, AUTOHAND_MOCK_BIN: unixPath(bin), AUTOHAND_INSTALL_SCRIPT: unixPath(path.resolve('install.sh')),
          AUTOHAND_HANDOFF_STUB: unixPath(stub), AUTOHAND_HANDOFF_RECORD: record,
          AUTOHAND_INSTALL_DIR: installDir, AUTOHAND_VERSION: '0.9.9', AUTOHAND_INSTALL_FIRST_RUN: 'no' },
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const handoff = JSON.parse((await readFile(record, 'utf8')).replace(/^\uFEFF/u, ''));
      expect(handoff).toMatchObject({ alpha: true, fresh: true, noZit: true, version: '0.9.9' });
      expect(path.normalize(handoff.installDir)).toBe(path.normalize(installDir));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 45000);
});
