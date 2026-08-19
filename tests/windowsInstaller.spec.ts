import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const installer = readFileSync(
  join(import.meta.dirname, '..', 'install.ps1'),
  'utf8',
);
const ciWorkflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
);

const windowsPowerShellTest = process.platform === 'win32' ? it : it.skip;

describe('Windows installer architecture detection', () => {
  it('falls back to native Windows architecture signals when RuntimeInformation is empty', () => {
    expect(installer).toContain('$env:PROCESSOR_ARCHITEW6432');
    expect(installer).toContain('$env:PROCESSOR_ARCHITECTURE');
    expect(installer).toContain('"AMD64" { return "windows-x64" }');
  });

  it('makes an undetectable architecture actionable', () => {
    expect(installer).toContain(
      'Autohand currently supports 64-bit Intel/AMD Windows (x64).',
    );
    expect(installer).toContain('RuntimeInformation.OSArchitecture=');
    expect(installer).toContain('PROCESSOR_ARCHITEW6432=');
    expect(installer).toContain('PROCESSOR_ARCHITECTURE=');
  });

  windowsPowerShellTest(
    'resolves x64 fallbacks and reports unknown signals in Windows PowerShell',
    () => {
      const probeDirectory = mkdtempSync(join(tmpdir(), 'autohand-install-arch-'));
      const probePath = join(probeDirectory, 'architecture-probe.ps1');
      const installerWithoutEntrypoint = installer.replace(
        /\r?\n# Run installer\r?\nInstall-Autohand\s*$/,
        '',
      );

      writeFileSync(
        probePath,
        `${installerWithoutEntrypoint}
$results = @(
    Get-Architecture -RuntimeArchitecture $null -ProcessorArchitectureW6432 "AMD64" -ProcessorArchitecture "x86"
    Get-Architecture -RuntimeArchitecture $null -ProcessorArchitectureW6432 $null -ProcessorArchitecture "AMD64"
    Get-Architecture -RuntimeArchitecture "X64" -ProcessorArchitectureW6432 $null -ProcessorArchitecture $null
)
$results | Write-Output
try {
    Get-Architecture -RuntimeArchitecture $null -ProcessorArchitectureW6432 $null -ProcessorArchitecture "x86"
}
catch {
    Write-Output "ERROR:$($_.Exception.Message)"
}
`,
      );

      try {
        const result = spawnSync(
          'powershell.exe',
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', probePath],
          { encoding: 'utf8' },
        );

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
          'windows-x64',
          'windows-x64',
          'windows-x64',
          'ERROR:Unsupported CPU architecture. RuntimeInformation.OSArchitecture=<empty>; PROCESSOR_ARCHITEW6432=<empty>; PROCESSOR_ARCHITECTURE=x86. Autohand currently supports 64-bit Intel/AMD Windows (x64). Please include this message when contacting support at https://autohand.ai/support.',
        ]);
      } finally {
        rmSync(probeDirectory, { recursive: true, force: true });
      }
    },
  );

  it('runs the architecture probe in the Windows CI matrix', () => {
    expect(ciWorkflow).toContain('bun run test -- tests/windowsInstaller.spec.ts');
  });
});
