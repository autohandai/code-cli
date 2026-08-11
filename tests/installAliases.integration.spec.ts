/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
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
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe('release installer command aliases', () => {
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
    writeFileSync(installedBinary, existingBinary);
    chmodSync(installedBinary, 0o755);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand']);
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

  unixIt('force-refreshes autohand-code and agent aliases in the install directory', () => {
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
      '#!/bin/sh\n[ "${1:-}" = "--version" ] && printf "test-version\\n"\n',
    );
    chmodSync(fixtureBinary, 0o755);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand']);
    const checksum = createHash('sha256')
      .update(readFileSync(archivePath))
      .digest('hex');
    writeFileSync(checksumPath, `${checksum}  autohand.tar.gz\n`);

    writeFakeCurl(fixtureBinDir);

    writeFileSync(join(installDir, 'agent'), 'owned by another installation\n');
    writeFileSync(join(installDir, 'autohand-code'), 'stale compatibility shim\n');

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

    const compatibilityAlias = join(installDir, 'autohand-code');
    const agentAlias = join(installDir, 'agent');
    expect(lstatSync(compatibilityAlias).isSymbolicLink()).toBe(true);
    expect(readlinkSync(compatibilityAlias)).toBe('autohand');
    expect(lstatSync(agentAlias).isSymbolicLink()).toBe(true);
    expect(readlinkSync(agentAlias)).toBe('autohand');
    expect(execFileSync(compatibilityAlias, ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
    expect(execFileSync(agentAlias, ['--version'], { encoding: 'utf8' })).toBe(
      'test-version\n',
    );
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
      '#!/bin/sh\n[ "${1:-}" = "--version" ] && printf "test-version\\n"\n',
    );
    chmodSync(fixtureBinary, 0o755);
    execFileSync('tar', ['-czf', archivePath, '-C', payloadDir, 'autohand']);
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
