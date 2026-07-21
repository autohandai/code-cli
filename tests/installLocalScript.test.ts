import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const localInstallScriptTest = existsSync('install-local.sh') ? it : it.skip;
const unixInstallScriptTest = process.platform === 'win32' ? it.skip : it;

describe('local install scripts', () => {
  it('does not run the package build script twice from bun run go', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const goScript = packageJson.scripts?.go ?? '';

    expect(goScript).toBe('./install-local.sh && echo "COMPLETED"');
    expect(goScript).not.toContain('bun run build');
    expect(goScript).not.toContain('--skip-compile');
  });

  it('runs unit and built Tuistory gates from the proof command', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const proofScript = packageJson.scripts?.proof ?? '';
    const unitProofScript = packageJson.scripts?.['proof:unit'] ?? '';

    expect(proofScript).toBe('bun run proof:unit && bun run proof:build-tuistory');
    expect(unitProofScript).toBe('eslint . && tsc --noEmit && node --max-old-space-size=8192 ./node_modules/vitest/vitest.mjs run');
    expect(unitProofScript).not.toContain('bun run');
  });

  it('runs dev through a minimal bun environment', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const devScript = packageJson.scripts?.dev ?? '';

    expect(devScript).toBe('env -i PATH="/Users/igorcosta/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" AUTOHAND_DEBUG="$AUTOHAND_DEBUG" bun src/index.ts');
  });

  it('preserves AUTOHAND_DEBUG through the sanitized dev environment', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const devScript = packageJson.scripts?.dev ?? '';

    expect(devScript).toContain('env -i ');
    expect(devScript).toContain('AUTOHAND_DEBUG="$AUTOHAND_DEBUG"');
  });

  localInstallScriptTest('compiles the installed binary without running nested package scripts', () => {
    const installScript = readFileSync('install-local.sh', 'utf8');

    expect(installScript).toContain('--skip-compile');
    expect(installScript).toContain('env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile');
    expect(installScript).toContain('INSTALL_PATH="$HOME/.local/bin/autohand"');
    expect(installScript).not.toContain('node ./node_modules/tsup/dist/cli-default.js');
    expect(installScript).not.toContain('bun run build');
    expect(installScript).not.toContain('bun run "compile:');
  });
});

describe('dependency install guardrails', () => {
  it('commits the Bun lockfile required by frozen installs', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(existsSync('bun.lock')).toBe(true);
    expect(gitignore.split(/\r?\n/)).not.toContain('bun.lock');
  });

  unixInstallScriptTest('repairs node-pty helper permissions after dependency installation', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      files?: string[];
      scripts?: Record<string, string>;
    };
    const permissionScript = resolve('scripts/ensure-node-pty-helper-permissions.mjs');
    const installRoot = mkdtempSync(join(tmpdir(), 'autohand-node-pty-install-'));
    const installedPackageRoot = join(installRoot, 'node_modules', 'autohand-cli');
    const installedPermissionScript = join(
      installedPackageRoot,
      'scripts',
      'ensure-node-pty-helper-permissions.mjs',
    );
    const nodePtyRoot = join(installRoot, 'node_modules', 'node-pty');
    const helperPath = join(
      nodePtyRoot,
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper',
    );

    try {
      expect(packageJson.scripts?.postinstall).toBe(
        'node scripts/ensure-node-pty-helper-permissions.mjs',
      );
      expect(packageJson.files).toContain('scripts/ensure-node-pty-helper-permissions.mjs');
      expect(existsSync(permissionScript)).toBe(true);

      mkdirSync(join(installedPermissionScript, '..'), { recursive: true });
      copyFileSync(permissionScript, installedPermissionScript);
      mkdirSync(join(helperPath, '..'), { recursive: true });
      writeFileSync(
        join(nodePtyRoot, 'package.json'),
        JSON.stringify({ name: 'node-pty', version: '1.1.0' }),
      );
      writeFileSync(helperPath, '#!/bin/sh\nexit 0\n');
      writeFileSync(join(helperPath, '..', 'pty.node'), 'native module placeholder');
      chmodSync(helperPath, 0o644);

      execFileSync(process.execPath, [installedPermissionScript], { cwd: installedPackageRoot });

      expect(statSync(helperPath).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it('does not apply Unix helper permissions on Windows installs', () => {
    const permissionScript = resolve('scripts/ensure-node-pty-helper-permissions.mjs');
    const missingNodePtyRoot = join(tmpdir(), `autohand-node-pty-windows-${Date.now()}`);

    expect(() => {
      execFileSync(process.execPath, [permissionScript, missingNodePtyRoot, 'win32', 'x64']);
    }).not.toThrow();
  });

  it('pins tuistory because its patch releases can introduce broken transitive ranges', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.devDependencies?.tuistory).toBe('0.10.1');
  });

  it('pins node-pty while the native helper permission workaround targets its layout', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['node-pty']).toBe('1.1.0');
  });

  it('uses the committed Bun lockfile in GitHub workflows', () => {
    for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const content = readFileSync(workflow, 'utf8');

      expect(content).not.toMatch(/\bbun install(?!\s+--frozen-lockfile)/);
    }
  });

  it('uses the dedicated single-thread Vitest mode in release CI', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(packageJson.scripts?.['test:ci']).toBe("node --max-old-space-size=8192 ./node_modules/vitest/vitest.mjs run --pool=threads --exclude 'tests/tuistory/**/*.tuistory.test.ts'");
    expect(releaseWorkflow).toContain('run: bun run test:ci');
  });

  it('runs built terminal tests in the Linux test gates', () => {
    for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const workflow = readFileSync(workflowPath, 'utf8');

      expect(workflow).toMatch(/test:\n(?:.|\n)*?runs-on: ubuntu-latest(?:.|\n)*?run: bun run test:tuistory/);
    }
  });

  it('smoke-tests compiled Windows binaries in CI and release workflows', () => {
    const workflows = [
      {
        path: '.github/workflows/ci.yml',
        binaryResolution: '$binary = (Resolve-Path "./binaries/autohand-test.exe").Path',
      },
      {
        path: '.github/workflows/release.yml',
        binaryResolution: '$binary = (Resolve-Path "./binaries/${{ matrix.artifact }}").Path',
      },
    ];

    for (const workflow of workflows) {
      const content = readFileSync(workflow.path, 'utf8');

      expect(content).toContain('- name: Smoke test Windows binary');
      expect(content).toContain("if: runner.os == 'Windows'");
      expect(content).toContain('shell: pwsh');
      expect(content).toContain('timeout-minutes: 1');
      expect(content).toContain(workflow.binaryResolution);
      expect(content).toContain('& $binary --version');
      expect(content).toContain('& $binary --help');
    }

    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ciWorkflow).toContain('- name: Verify binary (Unix)');
    expect(ciWorkflow).toContain("if: runner.os != 'Windows'");
    expect(ciWorkflow).toContain('chmod +x ./binaries/autohand-test');
    expect(ciWorkflow).toContain('./binaries/autohand-test --help');
  });

  it('bases alpha releases on the latest stable release tag before package.json fallback', () => {
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(releaseWorkflow).toContain('LATEST_STABLE_TAG=$(git tag --list');
    expect(releaseWorkflow).toContain("grep -Ev -- '-(alpha|beta|rc|pre)'");
    expect(releaseWorkflow).toContain('ALPHA_BASE_VERSION="${LATEST_STABLE_TAG#v}"');
    expect(releaseWorkflow).toContain('ALPHA_BASE_VERSION="${CURRENT_VERSION}"');
    expect(releaseWorkflow).toContain('MAJOR=$(echo $ALPHA_BASE_VERSION');
    expect(releaseWorkflow).not.toContain('Alpha: bump patch from current version');
  });

  it('generates GitHub release notes with the repository script and body_path', () => {
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(releaseWorkflow).toContain('node .github/generate-release-notes.mjs');
    expect(releaseWorkflow).toContain('--channel "${{ needs.prepare.outputs.channel }}"');
    expect(releaseWorkflow).toContain('body_path: release-notes.md');
    expect(releaseWorkflow).not.toContain('actions/github-script');
    expect(releaseWorkflow).not.toContain('body: ${{ steps.changelog.outputs.changelog }}');
  });
});
