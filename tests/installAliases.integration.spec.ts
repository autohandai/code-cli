/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
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

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe('release installer command aliases', () => {
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

    writeFileSync(join(installDir, 'agent'), 'owned by another installation\n');
    writeFileSync(join(installDir, 'autohand-code'), 'stale compatibility shim\n');

    execFileSync('/bin/sh', ['install.sh'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureBinDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
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
});
