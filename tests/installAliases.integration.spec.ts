/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const unixIt = process.platform === 'win32' ? it.skip : it;
const tempRoots: string[] = [];
// Deliberately excludes the developer's real PATH: once install.sh claims
// `agent` across every writable PATH directory, inheriting process.env.PATH
// here would let the sandboxed run mutate real directories like
// ~/.grok/bin or ~/.local/bin on the machine running the test.
const SAFE_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function writeFakeCurl(fixtureBinDir: string): void {
  const fakeCurl = join(fixtureBinDir, 'curl');
  writeFileSync(
    fakeCurl,
    `#!/bin/sh
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    http*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
case "$url" in
  *.sha256) cp "$AUTOHAND_TEST_CHECKSUM" "$output" ;;
  *) cp "$AUTOHAND_TEST_ARCHIVE" "$output" ;;
esac
`,
  );
  chmodSync(fakeCurl, 0o755);

  const fakeTimeout = join(fixtureBinDir, 'timeout');
  writeFileSync(fakeTimeout, '#!/bin/sh\nshift\n"$@"\n');
  chmodSync(fakeTimeout, 0o755);
}

function writeFixtureAhtraces(payloadDir: string): void {
  const fixture = join(payloadDir, 'ahtraces');
  writeFileSync(
    fixture,
    '#!/bin/sh\n[ "${1:-}" = "--version" ] && printf "test-version\\n"\nexit 0\n',
  );
  chmodSync(fixture, 0o755);
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe('release installer command aliases', () => {
  unixIt('restores the normal profile if creating its replacement fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'autohand-profile-rollback-'));
    tempRoots.push(root);
    const normal = join(root, '.autohand');
    mkdirSync(normal);
    writeFileSync(join(normal, 'config.json'), 'restore this configuration');
    const script = readFileSync(join(ROOT, 'install.sh'), 'utf8').replace(/main "\$@" \|\| exit 1\s*$/, `
mkdir() { return 1; }
reset_normal_profile
`);
    const result = spawnSync('/bin/sh', ['-c', script], {
      env: { ...process.env, HOME: root, PATH: SAFE_SYSTEM_PATH }, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Cannot create an empty normal profile');
    expect(readFileSync(join(normal, 'config.json'), 'utf8')).toBe('restore this configuration');
  });

  unixIt('rejects fresh mode on the stable channel before touching the profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'autohand-stable-fresh-'));
    tempRoots.push(root);
    const normal = join(root, '.autohand');
    mkdirSync(normal);
    writeFileSync(join(normal, 'config.json'), 'keep stable profile');
    const result = spawnSync('/bin/sh', ['install.sh', '--fresh'], {
      cwd: ROOT, env: { ...process.env, HOME: root, AUTOHAND_CHANNEL: 'stable' }, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('--fresh requires --alpha');
    expect(readFileSync(join(normal, 'config.json'), 'utf8')).toBe('keep stable profile');
  });

  unixIt('refuses to reset a linked normal profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'autohand-linked-profile-'));
    tempRoots.push(root);
    const home = join(root, 'home');
    const target = join(root, 'shared-profile');
    mkdirSync(home);
    mkdirSync(target);
    writeFileSync(join(target, 'config.json'), 'keep shared configuration');
    symlinkSync(target, join(home, '.autohand'));
    const script = readFileSync(join(ROOT, 'install.sh'), 'utf8').replace(/main "\$@" \|\| exit 1\s*$/, 'reset_normal_profile');
    const result = spawnSync('/bin/sh', ['-c', script], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('symlink');
    expect(lstatSync(join(home, '.autohand')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(target, 'config.json'), 'utf8')).toBe('keep shared configuration');
  });

  unixIt('installs the exact alpha and backs up the normal profile before resetting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'autohand-fresh-alpha-'));
    tempRoots.push(root);
    const home = join(root, 'home with spaces');
    const payload = join(root, 'payload');
    const fixtures = join(root, 'fixture-bin');
    const install = join(root, 'install');
    for (const dir of [home, payload, fixtures, install, join(home, '.autohand')]) mkdirSync(dir, { recursive: true });
    const normalConfig = join(home, '.autohand', 'config.json');
    writeFileSync(normalConfig, 'normal profile sentinel');
    const calls = join(root, 'computer-calls');
    writeFileSync(join(payload, 'autohand'), `#!/bin/sh
case "$1" in
  --version) printf '0.8.3-alpha.123abcd\\n' ;;
  computer) printf '%s\\n' "$*" >> "$AUTOHAND_TEST_CALLS"; exit "\${AUTOHAND_TEST_COMPUTER_EXIT:-0}" ;;
  *) printf '%s\\n' "$AUTOHAND_HOME" "\${AUTOHAND_CONFIG:-unset}" "$@" ;;
esac
`);
    chmodSync(join(payload, 'autohand'), 0o755);
    const archive = join(root, 'alpha.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', payload, 'autohand']);
    const checksum = `${archive}.sha256`;
    writeFileSync(checksum, createHash('sha256').update(readFileSync(archive)).digest('hex'));
    writeFakeCurl(fixtures);
    const environment = {
      ...process.env, HOME: home, PATH: `${fixtures}:${SAFE_SYSTEM_PATH}`,
      AUTOHAND_INSTALL_DIR: install, AUTOHAND_TEST_ARCHIVE: archive,
      AUTOHAND_TEST_CHECKSUM: checksum, AUTOHAND_VERSION: '0.8.3-alpha.123abcd',
      AUTOHAND_TEST_CALLS: calls, AUTOHAND_INSTALL_FIRST_RUN: 'no',
      AUTOHAND_CONFIG: normalConfig, AUTOHAND_HOME: join(home, '.autohand'),
      AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL: '0',
    };
    const runInstall = () => execFileSync('/bin/sh', ['install.sh', '--alpha', '--fresh'], {
      cwd: ROOT, env: environment, encoding: 'utf8',
    });
    expect(runInstall()).toContain('autohand-alpha');
    const launcher = join(install, 'autohand-alpha');
    const probe = () => execFileSync(launcher, ['probe', 'argument with spaces'], { env: environment, encoding: 'utf8' }).trim().split('\n');
    const first = probe();
    expect(first.slice(1)).toEqual(['unset', 'probe', 'argument with spaces']);
    expect(first[0]).not.toBe(join(home, '.autohand'));
    expect(existsSync(first[0])).toBe(true);
    expect(readdirSync(first[0])).toEqual([]);
    writeFileSync(join(first[0], 'test-session'), 'keep earlier test');
    runInstall();
    expect(probe()[0]).not.toBe(first[0]);
    expect(readFileSync(join(first[0], 'test-session'), 'utf8')).toBe('keep earlier test');
    expect(existsSync(normalConfig)).toBe(false);
    const backups = readdirSync(home).filter(name => name.startsWith('.autohand.backup.'));
    expect(backups).toHaveLength(2);
    const contents = backups.flatMap(name => {
      const config = join(home, name, 'profile', 'config.json');
      return existsSync(config) ? [readFileSync(config, 'utf8')] : [];
    });
    expect(contents).toContain('normal profile sentinel');
    expect(readFileSync(calls, 'utf8')).toContain('computer install --non-interactive --force');
    writeFileSync(normalConfig, 'keep profile when installation fails');
    const failed = spawnSync('/bin/sh', ['install.sh', '--alpha', '--fresh'], {
      cwd: ROOT, env: { ...environment, AUTOHAND_TEST_COMPUTER_EXIT: '17' }, encoding: 'utf8',
    });
    expect(failed.status).not.toBe(0);
    expect(readFileSync(normalConfig, 'utf8')).toBe('keep profile when installation fails');
    expect(readdirSync(home).filter(name => name.startsWith('.autohand.backup.'))).toHaveLength(2);
  });

  unixIt('rejects a downloaded binary that cannot start before replacing the installation', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-startup-'));
    tempRoots.push(tempRoot);
    const payloadDir = join(tempRoot, 'payload');
    const fixtureBinDir = join(tempRoot, 'fixture-bin');
    const installDir = join(tempRoot, 'install');
    const archivePath = join(tempRoot, 'autohand.tar.gz');
    const checksumPath = `${archivePath}.sha256`;
    const fixtureBinary = join(payloadDir, 'autohand');
    const installedBinary = join(installDir, 'autohand');
    const existingBinary = '#!/bin/sh\nprintf "existing-version\\n"\n';

    mkdirSync(payloadDir, { recursive: true });
    mkdirSync(fixtureBinDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    writeFileSync(fixtureBinary, '#!/bin/sh\nkill -9 $$\n');
    chmodSync(fixtureBinary, 0o755);
    writeFixtureAhtraces(payloadDir);
    writeFileSync(installedBinary, existingBinary);
    chmodSync(installedBinary, 0o755);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand', 'ahtraces']);
    const checksum = createHash('sha256')
      .update(readFileSync(archivePath))
      .digest('hex');
    writeFileSync(checksumPath, `${checksum}  autohand.tar.gz\n`);

    writeFakeCurl(fixtureBinDir);

    const result = spawnSync('/bin/sh', ['install.sh'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureBinDir}:${SAFE_SYSTEM_PATH}`,
        AUTOHAND_INSTALL_DIR: installDir,
        AUTOHAND_TEST_ARCHIVE: archivePath,
        AUTOHAND_TEST_CHECKSUM: checksumPath,
        AUTOHAND_VERSION: 'test-version',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('Error: Downloaded Autohand CLI failed to start');
    expect(readFileSync(installedBinary, 'utf8')).toBe(existingBinary);
  });

  unixIt('keeps the installer compatible with a release archive from before ahtraces', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-legacy-'));
    tempRoots.push(tempRoot);
    const payloadDir = join(tempRoot, 'payload');
    const fixtureBinDir = join(tempRoot, 'fixture-bin');
    const installDir = join(tempRoot, 'install');
    const archivePath = join(tempRoot, 'autohand.tar.gz');
    const checksumPath = `${archivePath}.sha256`;

    mkdirSync(payloadDir, { recursive: true });
    mkdirSync(fixtureBinDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    writeFileSync(
      join(payloadDir, 'autohand'),
      '#!/bin/sh\n[ "${1:-}" = "--version" ] && printf "test-version\\n"\nexit 0\n',
    );
    chmodSync(join(payloadDir, 'autohand'), 0o755);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand']);
    const checksum = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    writeFileSync(checksumPath, `${checksum}  autohand.tar.gz\n`);
    writeFakeCurl(fixtureBinDir);

    execFileSync('/bin/sh', ['install.sh'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureBinDir}:${SAFE_SYSTEM_PATH}`,
        AUTOHAND_INSTALL_DIR: installDir,
        AUTOHAND_TEST_ARCHIVE: archivePath,
        AUTOHAND_TEST_CHECKSUM: checksumPath,
        AUTOHAND_VERSION: 'test-version',
      },
    });

    expect(execFileSync(join(installDir, 'autohand'), ['--version'], { encoding: 'utf8' }))
      .toBe('test-version\n');
    expect(existsSync(join(installDir, 'ahtraces'))).toBe(false);
  });

  unixIt('force-refreshes autohand-code, agent, and ah aliases in the install directory', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-aliases-'));
    tempRoots.push(tempRoot);
    const payloadDir = join(tempRoot, 'payload');
    const fixtureBinDir = join(tempRoot, 'fixture-bin');
    const installDir = join(tempRoot, 'install');
    const archivePath = join(tempRoot, 'autohand.tar.gz');
    const checksumPath = `${archivePath}.sha256`;
    const fixtureBinary = join(payloadDir, 'autohand');

    mkdirSync(payloadDir, { recursive: true });
    mkdirSync(fixtureBinDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    writeFileSync(
      fixtureBinary,
      '#!/bin/sh\n[ "${1:-}" = "--version" ] && printf "test-version\\n"\nexit 0\n',
    );
    chmodSync(fixtureBinary, 0o755);
    writeFixtureAhtraces(payloadDir);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand', 'ahtraces']);
    const checksum = createHash('sha256')
      .update(readFileSync(archivePath))
      .digest('hex');
    writeFileSync(checksumPath, `${checksum}  autohand.tar.gz\n`);

    writeFakeCurl(fixtureBinDir);

    writeFileSync(join(installDir, 'agent'), 'owned by another installation\n');
    writeFileSync(join(installDir, 'autohand-code'), 'stale compatibility shim\n');
    writeFileSync(join(installDir, 'ah'), 'stale short alias\n');

    const installerOutput = execFileSync('/bin/sh', ['install.sh'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureBinDir}:${SAFE_SYSTEM_PATH}`,
        AUTOHAND_INSTALL_DIR: installDir,
        AUTOHAND_TEST_ARCHIVE: archivePath,
        AUTOHAND_TEST_CHECKSUM: checksumPath,
        AUTOHAND_VERSION: 'test-version',
      },
    });

    const compatibilityAlias = join(installDir, 'autohand-code');
    const agentAlias = join(installDir, 'agent');
    const shortAlias = join(installDir, 'ah');
    expect(lstatSync(compatibilityAlias).isSymbolicLink()).toBe(true);
    expect(readlinkSync(compatibilityAlias)).toBe('autohand');
    expect(lstatSync(agentAlias).isSymbolicLink()).toBe(true);
    expect(readlinkSync(agentAlias)).toBe('autohand');
    expect(lstatSync(shortAlias).isSymbolicLink()).toBe(true);
    expect(readlinkSync(shortAlias)).toBe('autohand');
    expect(execFileSync(compatibilityAlias, ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
    expect(execFileSync(agentAlias, ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
    expect(execFileSync(shortAlias, ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
    expect(execFileSync(join(installDir, 'ahtraces'), ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
    expect(installerOutput).toContain(`Installed trace monitor to ${join(installDir, 'ahtraces')}`);
    expect(installerOutput).toContain('Agent traces stay off until you choose during onboarding.');
    expect(installerOutput).toContain('autohand --traces-on');
    expect(installerOutput).toContain('ahtraces off');
  });

  unixIt('claims a competing agent binary elsewhere on PATH', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-path-claim-'));
    tempRoots.push(tempRoot);
    const payloadDir = join(tempRoot, 'payload');
    const fixtureBinDir = join(tempRoot, 'fixture-bin');
    const installDir = join(tempRoot, 'install');
    const competitorDir = join(tempRoot, 'competitor-bin');
    const archivePath = join(tempRoot, 'autohand.tar.gz');
    const checksumPath = `${archivePath}.sha256`;
    const fixtureBinary = join(payloadDir, 'autohand');

    mkdirSync(payloadDir, { recursive: true });
    mkdirSync(fixtureBinDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    mkdirSync(competitorDir, { recursive: true });
    writeFileSync(
      fixtureBinary,
      '#!/bin/sh\n[ "${1:-}" = "--version" ] && printf "test-version\\n"\nexit 0\n',
    );
    chmodSync(fixtureBinary, 0o755);
    writeFixtureAhtraces(payloadDir);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand', 'ahtraces']);
    const checksum = createHash('sha256')
      .update(readFileSync(archivePath))
      .digest('hex');
    writeFileSync(checksumPath, `${checksum}  autohand.tar.gz\n`);

    writeFakeCurl(fixtureBinDir);

    const competitorAgent = join(competitorDir, 'agent');
    writeFileSync(competitorAgent, '#!/bin/sh\necho "competitor agent"\n');
    chmodSync(competitorAgent, 0o755);

    execFileSync('/bin/sh', ['install.sh'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureBinDir}:${competitorDir}:${SAFE_SYSTEM_PATH}`,
        AUTOHAND_INSTALL_DIR: installDir,
        AUTOHAND_TEST_ARCHIVE: archivePath,
        AUTOHAND_TEST_CHECKSUM: checksumPath,
        AUTOHAND_VERSION: 'test-version',
      },
    });

    expect(lstatSync(competitorAgent).isSymbolicLink()).toBe(true);
    expect(readlinkSync(competitorAgent)).toBe(join(installDir, 'autohand'));
    expect(execFileSync(competitorAgent, ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
  });
});

describe('release installer binary replacement', () => {
  // `autohand update` runs install.sh from inside a running autohand, so the
  // installer always replaces an executable that is currently mapped by the
  // kernel. On macOS, writing into that inode in place invalidates the cached
  // code signature and every later launch dies with SIGKILL ("zsh: killed");
  // on Linux the same in-place write fails with ETXTBSY. Swapping in a fresh
  // inode via rename is safe on both, so the installed path must never keep
  // the inode of the binary it replaces.
  unixIt('replaces an existing binary with a fresh inode instead of writing into it', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-replace-'));
    tempRoots.push(tempRoot);
    const payloadDir = join(tempRoot, 'payload');
    const fixtureBinDir = join(tempRoot, 'fixture-bin');
    const installDir = join(tempRoot, 'install');
    const archivePath = join(tempRoot, 'autohand.tar.gz');
    const checksumPath = `${archivePath}.sha256`;
    const fixtureBinary = join(payloadDir, 'autohand');
    const installedBinary = join(installDir, 'autohand');
    const newBinary = '#!/bin/sh\n[ "${1:-}" = "--version" ] && printf "test-version\\n"\nexit 0\n';

    mkdirSync(payloadDir, { recursive: true });
    mkdirSync(fixtureBinDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    writeFileSync(fixtureBinary, newBinary);
    chmodSync(fixtureBinary, 0o755);
    writeFixtureAhtraces(payloadDir);
    writeFileSync(installedBinary, '#!/bin/sh\nprintf "existing-version\\n"\n');
    chmodSync(installedBinary, 0o755);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand', 'ahtraces']);
    const checksum = createHash('sha256')
      .update(readFileSync(archivePath))
      .digest('hex');
    writeFileSync(checksumPath, `${checksum}  autohand.tar.gz\n`);

    writeFakeCurl(fixtureBinDir);

    const existingInode = statSync(installedBinary).ino;

    execFileSync('/bin/sh', ['install.sh'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureBinDir}:${SAFE_SYSTEM_PATH}`,
        AUTOHAND_INSTALL_DIR: installDir,
        AUTOHAND_TEST_ARCHIVE: archivePath,
        AUTOHAND_TEST_CHECKSUM: checksumPath,
        AUTOHAND_VERSION: 'test-version',
      },
    });

    const installed = statSync(installedBinary);
    expect(installed.ino).not.toBe(existingInode);
    expect(installed.mode & 0o111).not.toBe(0);
    expect(readFileSync(installedBinary, 'utf8')).toBe(newBinary);
    expect(execFileSync(installedBinary, ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
    expect(readdirSync(installDir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });
});

describe('release installer first run', () => {
  // A fixture binary that answers --version for the startup probe and records
  // whatever the installer feeds it, so the test can see the first message.
  function seedFirstRunFixture(tempRoot: string): { installDir: string; env: Record<string, string> } {
    const payloadDir = join(tempRoot, 'payload');
    const fixtureBinDir = join(tempRoot, 'fixture-bin');
    const installDir = join(tempRoot, 'install');
    const archivePath = join(tempRoot, 'autohand.tar.gz');
    const checksumPath = `${archivePath}.sha256`;
    const launchLog = join(tempRoot, 'launch.log');
    mkdirSync(payloadDir, { recursive: true });
    mkdirSync(fixtureBinDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    writeFileSync(
      join(payloadDir, 'autohand'),
      `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then printf "test-version\\n"; exit 0; fi
if [ "\${1:-}" = "computer" ] && [ "\${2:-}" = "install" ]; then exit 0; fi
{ printf "args=%s\\n" "$*"; printf "stdin="; cat; } > "$AUTOHAND_TEST_LAUNCH_LOG"
`,
    );
    chmodSync(join(payloadDir, 'autohand'), 0o755);
    writeFixtureAhtraces(payloadDir);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand', 'ahtraces']);
    const checksum = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    writeFileSync(checksumPath, `${checksum}  autohand.tar.gz\n`);
    writeFakeCurl(fixtureBinDir);
    return {
      installDir,
      env: {
        ...process.env,
        PATH: `${fixtureBinDir}:${SAFE_SYSTEM_PATH}`,
        AUTOHAND_INSTALL_DIR: installDir,
        AUTOHAND_TEST_ARCHIVE: archivePath,
        AUTOHAND_TEST_CHECKSUM: checksumPath,
        AUTOHAND_TEST_LAUNCH_LOG: launchLog,
        AUTOHAND_VERSION: 'test-version',
      } as Record<string, string>,
    };
  }

  function runInstaller(env: Record<string, string>): string {
    return execFileSync('/bin/sh', ['install.sh'], { cwd: ROOT, encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  unixIt('fails the complete installer when its required computer component fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-computer-'));
    tempRoots.push(tempRoot);
    const { env } = seedFirstRunFixture(tempRoot);
    const payloadDir = join(tempRoot, 'payload');
    writeFileSync(join(payloadDir, 'autohand'), [
      '#!/bin/sh',
      '[ "${1:-}" = "--version" ] && { printf "test-version\\n"; exit 0; }',
      '[ "${1:-}" = "computer" ] && exit 7',
      'exit 0',
    ].join('\n'));
    execFileSync('tar', ['-czf', env.AUTOHAND_TEST_ARCHIVE, '-C', payloadDir, 'autohand', 'ahtraces']);
    const checksum = createHash('sha256').update(readFileSync(env.AUTOHAND_TEST_ARCHIVE)).digest('hex');
    writeFileSync(env.AUTOHAND_TEST_CHECKSUM, `${checksum}  autohand.tar.gz\n`);
    const result = spawnSync('/bin/sh', ['install.sh'], { cwd: ROOT, encoding: 'utf8', env });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Installation is incomplete');
    expect(result.stdout).not.toContain('Autohand Computer Use is ready');
    expect(result.stdout).not.toContain('Autohand CLI installed successfully');
  });

  unixIt('starts the installed binary with "hello world" as its first message when asked to', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-first-run-'));
    tempRoots.push(tempRoot);
    const { env } = seedFirstRunFixture(tempRoot);

    const output = runInstaller({ ...env, AUTOHAND_INSTALL_FIRST_RUN: 'yes' });

    expect(readFileSync(env.AUTOHAND_TEST_LAUNCH_LOG, 'utf8')).toBe('args=\nstdin=hello world\n');
    expect(output).toContain('Starting Autohand with your first message');
  });

  unixIt('does not start the binary when the first run is declined', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-first-run-'));
    tempRoots.push(tempRoot);
    const { env } = seedFirstRunFixture(tempRoot);

    const output = runInstaller({ ...env, AUTOHAND_INSTALL_FIRST_RUN: 'no' });

    expect(existsSync(env.AUTOHAND_TEST_LAUNCH_LOG)).toBe(false);
    expect(output).not.toContain('first message');
  });

  unixIt('neither asks nor starts the binary without a terminal or inside a running Autohand', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'autohand-installer-first-run-'));
    tempRoots.push(tempRoot);
    const { env } = seedFirstRunFixture(tempRoot);

    // execFileSync gives the installer pipes, not a terminal: an unattended install must finish on its own.
    const unattended = runInstaller(env);
    expect(existsSync(env.AUTOHAND_TEST_LAUNCH_LOG)).toBe(false);
    expect(unattended).not.toContain('first message');

    // `autohand upgrade` runs this script from inside Autohand; a nested session must never start.
    const nested = runInstaller({ ...env, AUTOHAND_CLI: '1', AUTOHAND_INSTALL_FIRST_RUN: '' });
    expect(existsSync(env.AUTOHAND_TEST_LAUNCH_LOG)).toBe(false);
    expect(nested).not.toContain('first message');
  });
});
