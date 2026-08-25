import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const installerWithoutEntrypoint = installer.replace(
  /\r?\n# Run installer\r?\nInstall-Autohand\s*$/u,
  '',
);

function resolvePowerShell(): string | null {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }

  const probe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
    encoding: 'utf8',
  });

  return probe.status === 0 ? 'pwsh' : null;
}

const powerShellExecutable = resolvePowerShell();

// The pure PATH-decision helpers touch no Windows-only API, so they are exercised on any
// host that has PowerShell. Windows CI additionally runs the registry round-trip below.
const powerShellTest = powerShellExecutable ? it : it.skip;

function runPowerShellProbe(script: string): { stdout: string; stderr: string; status: number | null } {
  const probeDirectory = mkdtempSync(join(tmpdir(), 'autohand-install-probe-'));
  const probePath = join(probeDirectory, 'probe.ps1');
  writeFileSync(probePath, script);

  try {
    const result = spawnSync(
      powerShellExecutable as string,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', probePath],
      { encoding: 'utf8' },
    );

    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }
}

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

describe('Windows installer user PATH safety', () => {
  it('never hands the user a PATH write that depends on a separately typed variable', () => {
    // The reported data loss: users ran only the SetEnvironmentVariable line, PowerShell
    // expanded the undefined $userPath to an empty string, and HKCU\Environment\PATH was
    // replaced by a single entry.
    expect(installer).not.toContain(
      "$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')",
    );
    expect(installer).not.toContain('`$userPath;$installPath`');
  });

  it('never uses setx, which silently truncates PATH at 1024 characters', () => {
    const executableLines = installer
      .split(/\r?\n/u)
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    expect(executableLines).not.toMatch(/\bsetx\b/iu);
  });

  it('updates the user PATH itself instead of delegating it to a copy-paste recipe', () => {
    expect(installer).toContain('function Add-AutohandToUserPath');
    expect(installer).toContain('function Get-UpdatedUserPath');
    expect(installer).toContain('Add-AutohandToUserPath -InstallPath $installPath');
  });

  it('reads the raw registry value so %VAR% tokens survive the round trip', () => {
    // [Environment]::GetEnvironmentVariable('PATH','User') expands REG_EXPAND_SZ values;
    // writing that back bakes %LOCALAPPDATA%\Microsoft\WindowsApps into a literal path.
    expect(installer).toContain('DoNotExpandEnvironmentNames');
    expect(installer).toContain('GetValueKind');
    expect(installer).toContain('[Microsoft.Win32.RegistryValueKind]::ExpandString');
  });

  it('refuses to write a PATH that is shorter than the one it read', () => {
    expect(installer).toContain('function Save-UserPathBackup');
    expect(installer).toContain('would shorten your user PATH');
  });

  it('keeps the manual fallback guarded so it cannot wipe PATH either', () => {
    expect(installer).toContain('if ($existing)');
  });

  powerShellTest('appends to a realistic user PATH without disturbing existing entries', () => {
    const install = 'C:\\Users\\dev\\AppData\\Local\\autohand';
    const current =
      '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Python312\\Scripts\\;C:\\Python312\\;C:\\tools\\rclone';

    const result = runPowerShellProbe(`${installerWithoutEntrypoint}
function Probe {
    param($Current, [string]$Install)
    $result = Get-UpdatedUserPath -CurrentPath $Current -InstallPath $Install
    if ($null -eq $result) { return "<unchanged>" }
    return $result
}

Write-Output (Probe -Current '${current}' -Install '${install}')
`);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`${current};${install}`);
  });

  powerShellTest('recognises entries that are already present in every spelling', () => {
    const install = 'C:\\Users\\dev\\AppData\\Local\\autohand';

    const result = runPowerShellProbe(`${installerWithoutEntrypoint}
function Probe {
    param($Current, [string]$Install)
    $result = Get-UpdatedUserPath -CurrentPath $Current -InstallPath $Install
    if ($null -eq $result) { return "<unchanged>" }
    return $result
}

Write-Output (Probe -Current 'C:\\a;${install};C:\\b' -Install '${install}')
Write-Output (Probe -Current 'C:\\a;c:\\users\\dev\\appdata\\local\\AUTOHAND\\;C:\\b' -Install '${install}')
Write-Output (Probe -Current 'C:\\a;"${install}";C:\\b' -Install '${install}')
Write-Output (Probe -Current 'C:\\a; ${install} ;C:\\b' -Install '${install}')
`);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
      '<unchanged>',
      '<unchanged>',
      '<unchanged>',
      '<unchanged>',
    ]);
  });

  powerShellTest('handles empty, missing and malformed PATH values without producing a wipe', () => {
    const install = 'C:\\Users\\dev\\AppData\\Local\\autohand';

    const result = runPowerShellProbe(`${installerWithoutEntrypoint}
function Probe {
    param($Current, [string]$Install)
    $result = Get-UpdatedUserPath -CurrentPath $Current -InstallPath $Install
    if ($null -eq $result) { return "<unchanged>" }
    return $result
}

Write-Output (Probe -Current '' -Install '${install}')
Write-Output (Probe -Current $null -Install '${install}')
Write-Output (Probe -Current 'C:\\a;' -Install '${install}')
Write-Output (Probe -Current 'C:\\a' -Install '${install}\\')
`);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
      install,
      install,
      `C:\\a;${install}`,
      `C:\\a;${install}`,
    ]);
  });

  powerShellTest('matches PATH entries literally rather than as wildcards or substrings', () => {
    const result = runPowerShellProbe(`${installerWithoutEntrypoint}
function Probe {
    param($Current, [string]$Install)
    $result = Get-UpdatedUserPath -CurrentPath $Current -InstallPath $Install
    if ($null -eq $result) { return "<unchanged>" }
    return $result
}

Write-Output (Probe -Current 'C:\\a;C:\\b' -Install 'C:\\Users\\d[e]v\\autohand')
Write-Output (Probe -Current 'C:\\Users\\dev\\AppData\\Local\\autohand-old' -Install 'C:\\Users\\dev\\AppData\\Local\\autohand')
`);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
      'C:\\a;C:\\b;C:\\Users\\d[e]v\\autohand',
      'C:\\Users\\dev\\AppData\\Local\\autohand-old;C:\\Users\\dev\\AppData\\Local\\autohand',
    ]);
  });

  powerShellTest('never returns a PATH that drops the value it was given', () => {
    const install = 'C:\\Users\\dev\\AppData\\Local\\autohand';
    const currents = [
      '%LOCALAPPDATA%\\Microsoft\\WindowsApps',
      'C:\\a;C:\\b;C:\\c',
      'C:\\a;',
      'C:\\Program Files\\Git\\cmd;C:\\tools\\restic',
    ];

    const probes = currents
      .map((current) => `Write-Output (Probe -Current '${current}' -Install '${install}')`)
      .join('\n');

    const result = runPowerShellProbe(`${installerWithoutEntrypoint}
function Probe {
    param($Current, [string]$Install)
    $result = Get-UpdatedUserPath -CurrentPath $Current -InstallPath $Install
    if ($null -eq $result) { return "<unchanged>" }
    return $result
}

${probes}
`);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const lines = result.stdout.trim().split(/\r?\n/u);
    expect(lines).toHaveLength(currents.length);
    lines.forEach((line, index) => {
      const current = currents[index] as string;
      expect(line.startsWith(current)).toBe(true);
      expect(line.length).toBeGreaterThanOrEqual(current.length);
    });
  });

  powerShellTest('fails closed without writing when the existing PATH cannot be read', () => {
    // A read failure must never be mistaken for "PATH is empty" - that is precisely how a
    // wipe happens. Off-Windows the registry API throws, which exercises the same branch.
    const result = runPowerShellProbe(`${installerWithoutEntrypoint}
$script:writeAttempts = 0
function Set-RawUserPath {
    param($Value, $Kind, $SubKeyName)
    $script:writeAttempts++
}

Add-AutohandToUserPath -InstallPath 'C:\\Users\\dev\\AppData\\Local\\autohand' -SubKeyName 'Software\\Autohand\\DoesNotExist'
Write-Output "writeAttempts=$script:writeAttempts"
`);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Could not read your user PATH');
    expect(result.stdout).toContain('Add Autohand to your PATH manually');
    expect(result.stdout).toContain('if ($existing)');
    expect(result.stdout).toContain('writeAttempts=0');
  });

  windowsPowerShellTest(
    'appends once, backs up the previous value, and is idempotent on a second run',
    () => {
      const subKey = 'Software\\AutohandInstallerTest\\Orchestration';
      const install = 'C:\\Users\\dev\\AppData\\Local\\autohand';
      const seeded = '%LOCALAPPDATA%\\Microsoft\\WindowsApps;C:\\Python312;C:\\tools\\restic';
      const backupDirectory = mkdtempSync(join(tmpdir(), 'autohand-path-backup-'));

      try {
        const result = runPowerShellProbe(`${installerWithoutEntrypoint}
$subKey = '${subKey}'
$seedKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subKey)
$seedKey.SetValue('PATH', '${seeded}', [Microsoft.Win32.RegistryValueKind]::ExpandString)
$seedKey.Dispose()

try {
    Add-AutohandToUserPath -InstallPath '${install}' -BackupDirectory '${backupDirectory}' -SubKeyName $subKey
    Add-AutohandToUserPath -InstallPath '${install}' -BackupDirectory '${backupDirectory}' -SubKeyName $subKey

    $final = Get-RawUserPath -SubKeyName $subKey
    Write-Output "VALUE=$($final.Value)"
    Write-Output "KIND=$($final.Kind)"
    Write-Output "BACKUPS=$((Get-ChildItem -LiteralPath '${backupDirectory}' -Filter 'user-path-backup-*.txt').Count)"
}
finally {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\\AutohandInstallerTest', $false)
}
`);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`VALUE=${seeded};${install}`);
        expect(result.stdout).toContain('KIND=ExpandString');
        expect(result.stdout).toContain('BACKUPS=1');
        expect(result.stdout).toContain('is already on your user PATH');

        const backups = readdirSync(backupDirectory).filter((name) =>
          name.startsWith('user-path-backup-'),
        );
        expect(backups).toHaveLength(1);
        expect(readFileSync(join(backupDirectory, backups[0] as string), 'utf8')).toBe(seeded);
      } finally {
        rmSync(backupDirectory, { recursive: true, force: true });
      }
    },
  );

  windowsPowerShellTest(
    'round-trips a REG_EXPAND_SZ PATH through the registry without expanding or downgrading it',
    () => {
      const subKey = 'Software\\AutohandInstallerTest\\RoundTrip';
      const install = 'C:\\Users\\dev\\AppData\\Local\\autohand';
      const seeded = '%LOCALAPPDATA%\\Microsoft\\WindowsApps;C:\\Python312';

      const result = runPowerShellProbe(`${installerWithoutEntrypoint}
$subKey = '${subKey}'
$seedKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subKey)
$seedKey.SetValue('PATH', '${seeded}', [Microsoft.Win32.RegistryValueKind]::ExpandString)
$seedKey.Dispose()

try {
    $before = Get-RawUserPath -SubKeyName $subKey
    Write-Output $before.Value
    Write-Output $before.Kind

    $updated = Get-UpdatedUserPath -CurrentPath $before.Value -InstallPath '${install}'
    Set-RawUserPath -Value $updated -Kind $before.Kind -SubKeyName $subKey

    $after = Get-RawUserPath -SubKeyName $subKey
    Write-Output $after.Value
    Write-Output $after.Kind
}
finally {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\\AutohandInstallerTest', $false)
}
`);

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
        seeded,
        'ExpandString',
        `${seeded};${install}`,
        'ExpandString',
      ]);
    },
  );
});
