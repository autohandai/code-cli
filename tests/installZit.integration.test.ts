import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const installer = readFileSync(path.join(import.meta.dirname, '../install.sh'), 'utf8').replace(/main "\$@" \|\| exit 1\s*$/, 'install_zit "$AUTOHAND_INSTALL_DIR"');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture({ corrupt = false, skip = false, existing = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zit-install-')); roots.push(root);
  for (const dir of ['bin', 'payload', 'install']) mkdirSync(path.join(root, dir));
  const target = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin') : (process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu');
  const name = `zit-v0.1.2-${target}`;
  const payload = path.join(root, 'payload', name); mkdirSync(payload);
  for (const name of ['zit', 'git-zit']) { writeFileSync(path.join(payload, name), '#!/bin/sh\necho zit-test\n'); chmodSync(path.join(payload, name), 0o755); }
  const archive = path.join(root, 'zit.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(root, 'payload'), name]);
  writeFileSync(path.join(root, 'checksum'), `${corrupt ? '0'.repeat(64) : createHash('sha256').update(readFileSync(archive)).digest('hex')}  zit.tar.gz\n`);
  writeFileSync(path.join(root, 'bin/curl'), `#!/bin/sh
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "$url" >> "$ZIT_TEST_ROOT/requests"
case "$url" in
  *.sha256) cp "$ZIT_TEST_ROOT/checksum" "$output" ;;
  *) cp "$ZIT_TEST_ROOT/zit.tar.gz" "$output" ;;
esac
`);
  chmodSync(path.join(root, 'bin/curl'), 0o755);
  writeFileSync(path.join(root, 'installer.sh'), installer);
  if (existing) { writeFileSync(path.join(root, 'bin/zit'), '#!/bin/sh\necho existing-zit\n'); chmodSync(path.join(root, 'bin/zit'), 0o755); }
  const result = spawnSync('/bin/sh', [path.join(root, 'installer.sh')], { encoding: 'utf8', env: { PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`, HOME: root, AUTOHAND_INSTALL_DIR: path.join(root, 'install'), ZIT_TEST_ROOT: root, AUTOHAND_SKIP_ZIT_INSTALL: skip ? '1' : '0' }, timeout: 10_000 });
  return { root, result };
}
describe('Zit installer integration', () => {
  it.skipIf(process.platform === 'win32')('installs the verified official binaries by default', () => {
    const { root, result } = fixture(); expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(root, 'install/zit'))).toBe(true);
    expect(existsSync(path.join(root, 'install/git-zit'))).toBe(true);
    expect(readFileSync(path.join(root, 'requests'), 'utf8')).toContain('autohandai/getzit/releases/download/v0.1.2/zit-v0.1.2-');
    expect(result.stdout).toContain('autohand --zit');
  });
  it.skipIf(process.platform === 'win32')('preserves existing Zit and supports opting out without downloads', () => {
    for (const options of [{ skip: true }, { existing: true }]) {
      const { root, result } = fixture(options); expect(result.status, result.stderr).toBe(0);
      expect(existsSync(path.join(root, 'requests'))).toBe(false);
    }
  });
  it.skipIf(process.platform === 'win32')('rejects checksum failures without installing or failing Autohand installation', () => {
    const { root, result } = fixture({ corrupt: true }); expect(result.status).toBe(0);
    expect(existsSync(path.join(root, 'install/zit'))).toBe(false);
    expect(result.stdout).toContain('checksum');
  });
  it('wires opt-outs into both installers and honestly reports native Windows availability', () => {
    expect(readFileSync(path.join(import.meta.dirname, '../install.sh'), 'utf8')).toContain('--no-zit)');
    const windows = readFileSync(path.join(import.meta.dirname, '../install.ps1'), 'utf8');
    expect(windows).toContain('[switch]$NoZit'); expect(windows).toContain('Install-Zit -InstallPath $installPath');
    expect(windows).toContain('AUTOHAND_SKIP_ZIT_INSTALL'); expect(windows).toContain('https://getzit.org');
  });
});
