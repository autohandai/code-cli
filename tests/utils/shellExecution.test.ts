import { afterEach, describe, expect, it } from 'vitest';
import { configureShellExecution, resolveShellExecution } from '../../src/utils/shellExecution.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../../src/actions/command.js';
import { executeShellCommandAsync, executeStreamingShellCommand } from '../../src/ui/shellCommand.js';
import { withCommandCoordination } from '../../src/session/peers/CommandCoordinationGate.js';
import type { ResourceCommand, ResourceCoordinatorClient } from '../../src/session/peers/ResourceCoordinator.js';

afterEach(() => configureShellExecution(undefined));

describe('shell execution profiles', () => {
  it.skipIf(process.platform === 'win32')('uses the selected shell for command tools and foreground execution', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autohand-shell-profile-'));
    try {
      const executable = path.join(directory, 'chosen shell');
      await writeFile(executable, '#!/bin/sh\nprintf "PROFILE_SELECTED\\n"\nexec /bin/sh "$@"\n', { mode: 0o755 });
      configureShellExecution({ executable, dialect: 'posix' });
      const command = await runCommand('printf hello', [], directory, { shell: true });
      expect(command.stdout).toContain('PROFILE_SELECTED');
      expect(command.stdout).toContain('hello');
      const foreground = await executeShellCommandAsync('printf hello', directory);
      expect(foreground.output).toContain('PROFILE_SELECTED');
      const streaming = await executeStreamingShellCommand('printf hello', directory, { preferPty: false });
      expect(streaming.output).toContain('PROFILE_SELECTED');
      const checked: ResourceCommand[] = [];
      const coordinator = {
        commandRequirements: async (command: ResourceCommand) => { checked.push(command); return []; },
        beginLaunch: async () => {}, publishLaunch: async () => {}, finishLaunch: async () => {},
      } as ResourceCoordinatorClient;
      await withCommandCoordination({ coordinator }, () => executeShellCommandAsync('printf hello', directory));
      expect(checked[0]).toEqual({ file: 'printf hello', args: [], cwd: directory });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('keeps a native Windows command in CMD when Git Bash is not selected', () => {
    expect(resolveShellExecution('echo hello', { platform: 'win32', environment: { ComSpec: 'C:\\Windows\\cmd.exe' } }))
      .toEqual({ file: 'C:\\Windows\\cmd.exe', args: ['/d', '/s', '/c', '"echo hello"'], dialect: 'cmd', windowsVerbatimArguments: true });
  });

  it('uses a Git Bash native executable rather than CMD', () => {
    expect(resolveShellExecution('printf "%s" "$VALUE"', { platform: 'win32', environment: {
      MSYSTEM: 'MINGW64', SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe',
    } })).toEqual({ file: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['-lc', 'printf "%s" "$VALUE"'], dialect: 'posix' });
  });

  it('preserves spaces and quoting when PowerShell is explicitly selected', () => {
    configureShellExecution({ executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' });
    expect(resolveShellExecution('Write-Output "hello world"', { platform: 'win32', environment: {} }))
      .toEqual({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output "hello world"'], dialect: 'powershell' });
  });

  it('honors an explicitly configured POSIX shell on Unix', () => {
    configureShellExecution({ executable: '/bin/sh' });
    expect(resolveShellExecution('printf ok', { platform: 'linux', environment: { SHELL: '/bin/zsh' } }))
      .toEqual({ file: '/bin/sh', args: ['-lc', 'printf ok'], dialect: 'posix' });
  });
});
