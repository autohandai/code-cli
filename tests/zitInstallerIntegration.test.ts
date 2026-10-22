import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const installer = readFileSync('install.sh', 'utf8').replace(/\nmain "\$@" \|\| exit 1\s*$/, '');
describe.skipIf(process.platform === 'win32')('published Zit installer compatibility', () => {
  for (const scenario of ['existing', 'disabled', 'download-failure', 'checksum-failure', 'verified'] as const) {
    it(`preserves the ${scenario} installation path`, () => {
      const root = mkdtempSync(join(tmpdir(), 'autohand-zit-install-'));
      try {
        const fixtures = join(root, 'fixtures');
        const bin = join(root, 'bin');
        const name = 'zit-v0.1.2-aarch64-apple-darwin';
        mkdirSync(fixtures); mkdirSync(bin); mkdirSync(join(root, name));
        for (const file of ['zit', 'git-zit']) writeFileSync(join(root, name, file), '#!/bin/sh\necho fixture-zit\n');
        const archive = join(root, 'archive.tar.gz');
        const tar = spawnSync('/usr/bin/tar', ['-czf', archive, '-C', root, name]);
        expect(tar.status).toBe(0);
        const digest = scenario === 'checksum-failure' ? '0'.repeat(64) : createHash('sha256').update(readFileSync(archive)).digest('hex');
        writeFileSync(join(fixtures, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo arm64 ;; esac\n');
        writeFileSync(join(fixtures, 'curl'), `#!/bin/sh\necho called >> "$HOME/curl-calls"\n${scenario === 'download-failure' ? 'exit 22' : ''}\nurl= output=\nwhile [ "$#" -gt 0 ]; do case "$1" in -o) output="$2"; shift 2 ;; http*) url="$1"; shift ;; *) shift ;; esac; done\ncase "$url" in *.sha256) echo '${digest}' > "$output" ;; *) cp "$HOME/archive.tar.gz" "$output" ;; esac\n`);
        for (const file of ['uname', 'curl']) chmodSync(join(fixtures, file), 0o755);
        if (scenario === 'existing') { writeFileSync(join(fixtures, 'zit'), '#!/bin/sh\necho existing\n'); chmodSync(join(fixtures, 'zit'), 0o755); }
        const result = spawnSync('/bin/sh', ['-c', `${installer}\ninstall_zit "$1"`, 'test', bin], {
          encoding: 'utf8', timeout: 15_000,
          env: { HOME: root, PATH: `${fixtures}:/usr/bin:/bin`, AUTOHAND_SKIP_ZIT_INSTALL: scenario === 'disabled' ? '1' : '0' },
        });
        expect(result.status, result.stderr).toBe(0);
        expect(existsSync(join(bin, 'zit'))).toBe(scenario === 'verified');
        if (scenario === 'verified') expect(readFileSync(join(bin, 'git-zit'), 'utf8')).toContain('fixture-zit');
        if (scenario === 'existing' || scenario === 'disabled') expect(existsSync(join(root, 'curl-calls'))).toBe(false);
        if (scenario === 'checksum-failure') expect(result.stdout).toContain('checksum verification failed');
        if (scenario === 'download-failure') expect(result.stdout).toContain('Autohand installation continues');
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
});
