/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

interface WorkflowStep {
  shell?: string;
  id?: string;
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  outputs?: Record<string, string>;
  needs?: string[];
  'runs-on'?: string;
  strategy?: {
    matrix?: {
      artifact?: string[];
      include?: Array<{
        os: string;
        target?: string;
        artifact: string;
        tracesArtifact?: string;
        computerUseArtifact?: string;
      }>;
    };
  };
  steps: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs: {
    prepare: WorkflowJob;
    build: WorkflowJob;
    'verify-macos-artifacts'?: WorkflowJob;
    release: WorkflowJob;
  };
}

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_PATH = path.resolve(import.meta.dirname, '../../.github/workflows/release.yml');
const CI_WORKFLOW_PATH = path.resolve(import.meta.dirname, '../../.github/workflows/ci.yml');

function loadReleaseWorkflow(): ReleaseWorkflow {
  return parseYaml(readFileSync(WORKFLOW_PATH, 'utf8')) as ReleaseWorkflow;
}

function loadReleaseSteps(): WorkflowStep[] {
  return loadReleaseWorkflow().jobs.release.steps;
}

const MACOS_SECRETS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
] as const;

function runMacOsSigningPreflight(channel: string, credentials: Record<string, string> = {}) {
  const step = loadReleaseWorkflow().jobs.prepare.steps.find(
    (step) => step.name === 'Select macOS signing mode',
  );
  if (!step?.run) {
    throw new Error('Release workflow must select macOS signing mode before building');
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'autohand-signing-mode-'));
  const outputPath = path.join(directory, 'github-output');
  try {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_OUTPUT: outputPath,
        RELEASE_CHANNEL: channel,
        ...Object.fromEntries(MACOS_SECRETS.map((name) => [name, ''])),
        ...credentials,
      },
      timeout: 5_000,
    });
    return {
      status: result.status,
      diagnostics: result.stdout + result.stderr,
      output: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runVersionStep(manualVersion: string): string {
  const versionStep = loadReleaseWorkflow().jobs.prepare.steps.find(
    (step) => step.name === 'Get version',
  );
  const script = versionStep?.run
    ?.replaceAll('${{ steps.determine.outputs.channel }}', 'release')
    .replaceAll('${{ github.event.inputs.version }}', manualVersion)
    .replaceAll('${{ github.event_name }}', 'workflow_dispatch');

  if (!script) {
    throw new Error('Release workflow must define the Get version step');
  }

  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'autohand-release-version-'));
  const outputPath = path.join(outputDirectory, 'github-output');

  try {
    execFileSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_SHA: '8595299fa7c2cb2f63715b03c48e39f26c6e2f7e',
        MANUAL_VERSION: manualVersion,
        RELEASE_CHANNEL: 'release',
        RELEASE_EVENT_NAME: 'workflow_dispatch',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return readFileSync(outputPath, 'utf8');
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

describe('release workflow', () => {
  it('keeps the Computer Use deployment target independent of the macOS runner version', () => {
    const build = loadReleaseWorkflow().jobs.build.steps.find(step => step.name === 'Build Autohand Computer Use host');
    expect(build?.run).toContain('computer-use-component/autohand/scripts/build-macos-host.sh');
    expect(build?.run).not.toContain('/usr/bin/swiftc');
  });

  it('builds and bundles both musl architectures alongside glibc Linux', () => {
    const workflow = loadReleaseWorkflow();
    const targets = workflow.jobs.build.strategy?.matrix?.include ?? [];
    const bundle = workflow.jobs.release.steps.find(step => step.name === 'Create bundled archives for installers and ACP registry')?.run ?? '';
    for (const arch of ['x64', 'arm64']) {
      expect(targets).toContainEqual(expect.objectContaining({
        target: `linux-${arch}-musl`, artifact: `autohand-linux-${arch}-musl`, tracesArtifact: `ahtraces-linux-${arch}-musl`,
      }));
      expect(bundle).toContain(`bundle_unix "autohand-linux-${arch}-musl" "ahtraces-linux-${arch}-musl"`);
      expect(targets).toContainEqual(expect.objectContaining({ target: `linux-${arch}` }));
    }
  });

  it('installs native dependencies for cross-compiled architectures before compiling', () => {
    const steps = loadReleaseWorkflow().jobs.build.steps;
    const compileIndex = steps.findIndex(step => step.name === 'Compile binaries');
    for (const name of ['Install dependencies', 'Install ahtraces dependencies']) {
      const index = steps.findIndex(step => step.name === name);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(compileIndex);
      expect(steps[index]?.run).toContain('--frozen-lockfile --cpu="*"');
    }
  });

  it('uses Bash for compilation on Windows as well as Unix runners', () => {
    const step = loadReleaseWorkflow().jobs.build.steps.find(step => step.name === 'Compile binaries');
    expect(step?.shell).toBe('bash');
  });

  it.each(['alpha', 'release'])('blocks %s publication when Apple signing credentials are unavailable', channel => {
    const result = runMacOsSigningPreflight(channel);
    expect(result.status, result.diagnostics).toBe(1);
    expect(result.output).toBe('');
    expect(result.diagnostics).toContain('CSC_LINK');
  });

  it.each(['alpha', 'release'])('selects Developer ID signing for fully configured %s releases', (channel) => {
    const credentials = Object.fromEntries(MACOS_SECRETS.map((name) => [name, `secret-${name}`]));
    const result = runMacOsSigningPreflight(channel, credentials);
    expect(result.status, result.diagnostics).toBe(0);
    expect(result.output).toBe('mode=developer-id\n');
    expect(result.diagnostics).not.toContain('secret-');
  });

  it.each(['alpha', 'release'].flatMap(channel => MACOS_SECRETS.map(missing => ({ channel, missing }))))(
    'does not silently downgrade $channel when $missing is missing from configured signing', ({ channel, missing }) => {
      const credentials = Object.fromEntries(MACOS_SECRETS.map((name) => [name, `secret-${name}`]));
      delete credentials[missing];
      const result = runMacOsSigningPreflight(channel, credentials);
      expect(result.status).toBe(1);
      expect(result.output).toBe('');
      expect(result.diagnostics).toContain(missing);
      expect(result.diagnostics).not.toContain('secret-');
    },
  );

  it('requires Developer ID signing and API notarization without a release fallback', () => {
    const workflow = loadReleaseWorkflow();
    const preflight = workflow.jobs.prepare.steps.find(step => step.name === 'Select macOS signing mode');
    expect(preflight?.id).toBe('macos-signing');
    expect(preflight?.if).toBe("steps.check.outputs.should_release == 'true'");
    for (const name of MACOS_SECRETS) {
      expect(preflight?.env?.[name]).toBe('${{ secrets.' + name + ' }}');
    }
    expect(workflow.jobs.prepare.outputs?.macos_signing_mode).toBe('${{ steps.macos-signing.outputs.mode }}');
    expect(workflow.jobs.build.steps.some(step => step.name === 'Ad-hoc sign macOS artifacts')).toBe(false);
    expect(workflow.jobs.release.steps.some(step => step.name === 'Document ad-hoc macOS signing')).toBe(false);
    const sign = workflow.jobs.build.steps.find(step => step.name === 'Sign and notarize macOS artifacts');
    expect(sign?.run).toContain('--key "$APPLE_API_KEY_PATH"');
    expect(sign?.run).toContain('--key-id "$APPLE_API_KEY_ID"');
    expect(sign?.run).toContain('--issuer "$APPLE_API_ISSUER"');
    expect(sign?.run).not.toContain('--apple-id');
  });

  it.skipIf(process.platform !== 'darwin')('preserves Bun runtime entitlements when signing hardened executables', () => {
    const script = loadReleaseWorkflow().jobs.build.steps.find(step => step.name === 'Sign and notarize macOS artifacts')?.run;
    expect(script).toBeDefined();
    const directory = mkdtempSync(path.join(tmpdir(), 'autohand-hardened-signing-'));
    const binaries = path.join(directory, 'binaries');
    const app = path.join(binaries, 'Autohand Computer Use.app');
    try {
      mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
      const source = path.join(directory, 'probe.js');
      writeFileSync(source, 'console.log("hardened-signing-fixture");\n');
      const executable = path.join(binaries, 'autohand-probe');
      execFileSync('bun', ['build', source, '--compile', '--outfile', executable], { stdio: 'pipe', timeout: 20_000 });
      copyFileSync(executable, path.join(binaries, 'ahtraces-probe'));
      copyFileSync('/usr/bin/true', path.join(app, 'Contents/MacOS/probe'));
      writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>probe</string>
<key>CFBundleIdentifier</key><string>ai.autohand.hardened-signing-fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
      const signing = spawnSync('bash', ['-euo', 'pipefail', '-c', script!
        .split('mkdir -p ./binaries/notarization')[0]!
        .replace(/IDENTITY=.*/, 'IDENTITY="-"')
        .replaceAll('--timestamp', '--timestamp=none')
        .replaceAll('--keychain "$AUTOHAND_CODESIGN_KEYCHAIN"', '')
        .replaceAll('./native/macos/cli.entitlements.plist', path.join(REPOSITORY_ROOT, 'native/macos/cli.entitlements.plist'))
        .replaceAll('${{ matrix.artifact }}', 'autohand-probe')
        .replaceAll('${{ matrix.tracesArtifact }}', 'ahtraces-probe')], {
        cwd: directory, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, DEVELOPER_NAME: 'fixture', TEAM_ID: 'fixture', APPLE_ID: 'fixture', APP_SPECIFIC_PASSWORD: 'fixture' },
      });
      expect(signing.status, signing.stderr).toBe(0);
      for (const name of ['autohand-probe', 'ahtraces-probe']) {
        const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', path.join(binaries, name)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        expect(entitlements).toContain('<key>com.apple.security.cs.allow-jit</key>');
        expect(entitlements).toContain('<key>com.apple.security.cs.allow-unsigned-executable-memory</key>');
        expect(entitlements).toContain('<key>com.apple.security.cs.disable-library-validation</key>');
        expect(entitlements).not.toContain('com.apple.security.get-task-allow');
        const result = spawnSync(path.join(binaries, name), { encoding: 'utf8', timeout: 5_000 });
        expect(result.status, result.stderr + String(result.signal ?? '')).toBe(0);
        expect(result.stdout.trim()).toBe('hardened-signing-fixture');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps local native compile scripts aligned with release optional dependency handling', () => {
    const packageJson = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const compileStep = loadReleaseWorkflow().jobs.build.steps.find(
      (step) => step.name === 'Compile binaries',
    );

    expect(compileStep?.run).toContain('--external node-llama-cpp');
    for (const target of [
      'macos-arm64',
      'macos-x64',
      'linux-x64',
      'linux-arm64',
      'windows-x64',
      'windows-arm64',
    ]) {
      expect(packageJson.scripts[`compile:${target}`]).toContain(
        './src/index.ts --compile --target=',
      );
      expect(packageJson.scripts[`compile:${target}`]).toContain('--external node-llama-cpp');
      expect(packageJson.scripts[`compile:${target}`]).not.toContain('ahtraces');
    }
  });

  it('pins the private ahtraces source to an immutable commit', () => {
    const revision = readFileSync(
      path.join(REPOSITORY_ROOT, '.github/ahtraces-ref'),
      'utf8',
    ).trim();
    expect(revision).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('smoke tests fresh alpha installation before uploading release artifacts', () => {
    const steps = loadReleaseWorkflow().jobs.build.steps;
    const smoke = steps.find(step => step.name === 'Verify fresh alpha installation');
    expect(smoke?.run).toContain('src/testing/scenarios/fresh-alpha-install.sh');
    expect(smoke?.run).toContain('${{ needs.prepare.outputs.version }}');
    expect(smoke?.run).toContain('${{ matrix.tracesArtifact }}');
    expect(smoke?.env?.AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL).not.toBe('1');
    expect(steps.indexOf(smoke!)).toBeLessThan(steps.findIndex(step => step.name === 'Upload artifact'));
    const ci = parseYaml(readFileSync(CI_WORKFLOW_PATH, 'utf8')) as { jobs: { 'build-test': WorkflowJob } };
    expect(ci.jobs['build-test'].steps.find(step => step.name === 'Verify fresh alpha installation')?.run)
      .toContain('src/testing/scenarios/fresh-alpha-install.sh');
  });

  it('pins the separate computer-use source to an immutable commit', () => {
    const revision = readFileSync(
      path.join(REPOSITORY_ROOT, '.github/computer-use-ref'),
      'utf8',
    ).trim();
    const buildSteps = loadReleaseWorkflow().jobs.build.steps;
    const refStep = buildSteps.find((step) => step.name === 'Read pinned computer-use revision');
    const checkoutStep = buildSteps.find(
      (step) => step.name === 'Checkout pinned computer-use component',
    );

    expect(revision).toMatch(/^[0-9a-f]{40}$/u);
    expect(refStep?.run).toContain('.github/computer-use-ref');
    expect(checkoutStep?.uses).toBe('actions/checkout@v7');
    expect(checkoutStep?.with).toMatchObject({
      repository: 'autohandai/computer-use',
      ref: '${{ steps.computer-use-ref.outputs.sha }}',
      path: 'computer-use-component',
      'persist-credentials': false,
    });
  });

  it('embeds the pinned ahtraces revision into every standalone companion build', () => {
    const releaseCompile = loadReleaseWorkflow().jobs.build.steps.find(
      (step) => step.name === 'Compile binaries',
    );
    const ciWorkflow = parseYaml(readFileSync(CI_WORKFLOW_PATH, 'utf8')) as {
      jobs: { 'ahtraces-component': WorkflowJob };
    };
    const ciCompile = ciWorkflow.jobs['ahtraces-component'].steps.find(
      (step) => step.name === 'Compile and smoke test component',
    );

    expect(releaseCompile?.env?.BUILD_GIT_COMMIT).toBe('${{ steps.ahtraces-ref.outputs.sha }}');
    expect(releaseCompile?.run).toContain("'--env=BUILD_GIT_*'");
    expect(ciCompile?.env?.BUILD_GIT_COMMIT).toBe('${{ steps.ahtraces-ref.outputs.sha }}');
  });

  it('embeds Autohand version and commit metadata in standalone CLI binaries', () => {
    const compile = loadReleaseWorkflow().jobs.build.steps.find(
      (step) => step.name === 'Compile binaries',
    );

    expect(compile?.run).toContain('AUTOHAND_BUILD_VERSION="${{ needs.prepare.outputs.version }}"');
    expect(compile?.run).toContain('AUTOHAND_BUILD_GIT_COMMIT="${GITHUB_SHA}"');
    expect(compile?.run).toContain("'--env=AUTOHAND_BUILD_*'");
  });

  it('preserves the CI binary identity when it is installed outside the checkout', () => {
    const ci = parseYaml(readFileSync(CI_WORKFLOW_PATH, 'utf8')) as {
      jobs: { 'build-test': WorkflowJob };
    };
    const compile = ci.jobs['build-test'].steps.find(step => step.name === 'Test compilation');

    expect(compile?.env?.AUTOHAND_BUILD_GIT_COMMIT).toBe('${{ github.sha }}');
    expect(compile?.run).toContain("'--env=AUTOHAND_BUILD_*'");
  });

  it('builds and bundles the branded macOS computer use host', () => {
    const workflow = loadReleaseWorkflow();
    const buildSteps = workflow.jobs.build.steps;
    const hostBuild = buildSteps.find((step) => step.name === 'Build Autohand Computer Use host');
    const sign = buildSteps.find((step) => step.name === 'Sign and notarize macOS artifacts');
    const upload = buildSteps.find((step) => step.name === 'Upload artifact');
    const bundle = workflow.jobs.release.steps.find(
      (step) => step.name === 'Create bundled archives for installers and ACP registry',
    );
    const npmPackage = workflow.jobs.release.steps.find(
      (step) => step.name === 'Build and verify npm package',
    );

    expect(hostBuild?.if).toBe("runner.os == 'macOS'");
    expect(hostBuild?.run).toContain(
      './computer-use-component/autohand/scripts/build-macos-host.sh',
    );
    expect(hostBuild?.run).not.toContain('autohand-computer-use-${{ matrix.target }}.tar.gz');
    expect(sign?.run).toContain('autohand-computer-use-${{ matrix.target }}.tar.gz');
    expect(upload?.with?.path).toContain('./binaries/autohand-computer-use-*.tar.gz');
    expect(upload?.with?.path).not.toContain('${{ matrix.computerUseArtifact }}');
    expect(bundle?.run).toContain('Autohand Computer Use.app');
    expect(npmPackage?.run).toContain('native/macos/prebuilt/arm64');
    expect(npmPackage?.run).toContain('native/macos/prebuilt/x64');
  });

  it('normalizes a v-prefixed manual stable version before publishing', () => {
    expect(runVersionStep('v0.9.3')).toContain('version=0.9.3\n');
  });

  it('rejects malformed stable versions without interpolating user input into the shell', () => {
    const versionStep = loadReleaseWorkflow().jobs.prepare.steps.find(
      (step) => step.name === 'Get version',
    );

    expect(versionStep?.env?.MANUAL_VERSION).toBe('${{ github.event.inputs.version }}');
    expect(versionStep?.run).not.toContain('${{ github.event.inputs.version }}');
    expect(() => runVersionStep('vv0.9.3')).toThrow();
  });

  it('documents the accepted manual stable version formats', () => {
    const documentation = readFileSync(
      path.join(REPOSITORY_ROOT, '.github/workflows/README.md'),
      'utf8',
    );

    expect(documentation).toContain('`1.2.3` or `v1.2.3`');
    expect(documentation).toContain('normalizes the optional leading `v`');
  });

  it('preflights release artifacts before publishing and never hides source push failures', () => {
    const steps = loadReleaseSteps();
    const preflightIndex = steps.findIndex(
      (step) => step.name === 'Prepare Homebrew tap update (release only)',
    );
    const packageBuildIndex = steps.findIndex(
      (step) => step.name === 'Build and verify npm package',
    );
    const createReleaseIndex = steps.findIndex((step) => step.name === 'Create Release');
    const updateTapIndex = steps.findIndex((step) => step.name === 'Update Homebrew tap');
    const preflightStep = steps[preflightIndex];
    const workflowScripts = steps
      .map((step) => step.run ?? '')
      .join('\n');

    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(packageBuildIndex).toBeGreaterThanOrEqual(0);
    expect(createReleaseIndex).toBeGreaterThanOrEqual(0);
    expect(updateTapIndex).toBeGreaterThan(createReleaseIndex);
    expect(preflightIndex).toBeLessThan(createReleaseIndex);
    expect(packageBuildIndex).toBeLessThan(createReleaseIndex);

    expect(preflightStep?.if).toBe("needs.prepare.outputs.channel == 'release'");
    expect(preflightStep?.env).toEqual({
      TAP_GITHUB_TOKEN: '${{ secrets.TAP_GITHUB_TOKEN }}',
    });
    expect(preflightStep?.run).toContain('TAP_GITHUB_TOKEN is required for stable releases');
    expect(preflightStep?.run).toContain('node .github/render-homebrew-formula.mjs');
    expect(preflightStep?.run).toContain('ruby -c homebrew-tap/Formula/autohand-code.rb');
    expect(preflightStep?.run).toContain('TAP_CAN_PUSH');

    expect(workflowScripts).not.toContain('git push origin ${{ github.ref_name }}');
    expect(workflowScripts).not.toContain('No changes to push');
  });

  it('signs macOS binaries after compilation and verifies transported artifacts before release', () => {
    const workflow = loadReleaseWorkflow();
    const buildSteps = workflow.jobs.build.steps;
    const buildTargets = workflow.jobs.build.strategy?.matrix?.include;
    const componentRefIndex = buildSteps.findIndex((step) => step.name === 'Read pinned ahtraces revision');
    const componentCheckoutIndex = buildSteps.findIndex((step) => step.name === 'Checkout pinned ahtraces component');
    const compileIndex = buildSteps.findIndex((step) => step.name === 'Compile binaries');
    const certificateIndex = buildSteps.findIndex(
      (step) => step.name === 'Import macOS signing certificate',
    );
    const signIndex = buildSteps.findIndex(
      (step) => step.name === 'Sign and notarize macOS artifacts',
    );
    const smokeIndex = buildSteps.findIndex((step) => step.name === 'Smoke test binary');
    const uploadIndex = buildSteps.findIndex((step) => step.name === 'Upload artifact');
    const certificateStep = buildSteps[certificateIndex];
    const signStep = buildSteps[signIndex];

    expect(componentRefIndex).toBeGreaterThanOrEqual(0);
    expect(componentCheckoutIndex).toBeGreaterThan(componentRefIndex);
    expect(compileIndex).toBeGreaterThan(componentCheckoutIndex);
    expect(certificateIndex).toBeGreaterThan(compileIndex);
    expect(signIndex).toBeGreaterThan(compileIndex);
    expect(signIndex).toBeGreaterThan(certificateIndex);
    expect(smokeIndex).toBeGreaterThan(signIndex);
    expect(uploadIndex).toBeGreaterThan(smokeIndex);
    expect(certificateStep?.if).toBe("runner.os == 'macOS' && needs.prepare.outputs.macos_signing_mode == 'developer-id'");
    expect(certificateStep?.env).toMatchObject({
      CSC_LINK: '${{ secrets.CSC_LINK }}',
      CSC_KEY_PASSWORD: '${{ secrets.CSC_KEY_PASSWORD }}',
    });
    expect(certificateStep?.run).toContain('autohand/scripts/import-apple-signing.sh');
    expect(signStep?.if).toBe("runner.os == 'macOS' && needs.prepare.outputs.macos_signing_mode == 'developer-id'");
    expect(signStep?.env).toMatchObject({
      APPLE_API_KEY_ID: '${{ secrets.APPLE_API_KEY_ID }}',
      APPLE_API_ISSUER: '${{ secrets.APPLE_API_ISSUER }}',
    });
    expect(signStep?.run).toContain('codesign --force --timestamp --options runtime');
    expect(signStep?.run).toContain('codesign --verify --strict --verbose=4');
    expect(signStep?.run).toContain('matrix.tracesArtifact');
    expect(signStep?.run).toContain('Autohand Computer Use.app');
    expect(signStep?.run).toContain('xcrun notarytool submit');
    expect(signStep?.run).toContain('xcrun stapler staple');
    expect(signStep?.run).toContain('spctl -a -vv -t exec');
    expect(signStep?.run).toContain('autohand-computer-use-${{ matrix.target }}.tar.gz');
    expect(signStep?.run).not.toContain('codesign --force --sign -');
    expect(buildSteps[componentCheckoutIndex]?.uses).toBe('actions/checkout@v7');
    expect(buildSteps[componentCheckoutIndex]?.with).toMatchObject({
      repository: 'autohandai/ahtraces',
      ref: '${{ steps.ahtraces-ref.outputs.sha }}',
      path: 'ahtraces-component',
      token: '${{ secrets.AHTRACES_REPO_TOKEN }}',
    });
    expect(buildSteps[compileIndex]?.run).toContain('./src/index.ts');
    expect(buildSteps[compileIndex]?.run).toContain('./ahtraces-component/src/index.ts');
    expect(buildSteps[compileIndex]?.run).not.toContain('./src/ahtraces.ts');
    expect(buildSteps[smokeIndex]?.run).toContain('matrix.tracesArtifact');
    expect(buildSteps[uploadIndex]?.with?.path).toContain('${{ matrix.tracesArtifact }}');
    expect(buildTargets).toEqual(expect.arrayContaining([
      {
        os: 'macos-26',
        target: 'darwin-arm64',
        artifact: 'autohand-macos-arm64',
        tracesArtifact: 'ahtraces-macos-arm64',
        computerUseArtifact: 'autohand-computer-use-darwin-arm64.tar.gz',
      },
      {
        os: 'macos-26-intel',
        target: 'darwin-x64',
        artifact: 'autohand-macos-x64',
        tracesArtifact: 'ahtraces-macos-x64',
        computerUseArtifact: 'autohand-computer-use-darwin-x64.tar.gz',
      },
      {
        os: 'windows-latest',
        target: 'windows-arm64',
        artifact: 'autohand-windows-arm64.exe',
        tracesArtifact: 'ahtraces-windows-arm64.exe',
      },
    ]));

    const windowsSmoke = buildSteps.find((step) => step.name === 'Smoke test Windows binary');
    expect(windowsSmoke?.if).toContain("!contains(matrix.target, 'arm64')");

    const transportJob = workflow.jobs['verify-macos-artifacts'];
    const downloadStep = transportJob?.steps.find(
      (step) => step.name === 'Download macOS artifact',
    );
    const verifyStep = transportJob?.steps.find(
      (step) => step.name === 'Verify transported macOS binary',
    );

    expect(transportJob?.needs).toEqual(['prepare', 'build']);
    expect(transportJob?.['runs-on']).toBe('${{ matrix.os }}');
    expect(transportJob?.strategy?.matrix?.include).toEqual([
      {
        os: 'macos-26',
        artifact: 'autohand-macos-arm64',
        tracesArtifact: 'ahtraces-macos-arm64',
        computerUseArtifact: 'autohand-computer-use-darwin-arm64.tar.gz',
      },
      {
        os: 'macos-26-intel',
        artifact: 'autohand-macos-x64',
        tracesArtifact: 'ahtraces-macos-x64',
        computerUseArtifact: 'autohand-computer-use-darwin-x64.tar.gz',
      },
    ]);
    expect(downloadStep?.uses).toBe('actions/download-artifact@v8');
    expect(downloadStep?.with).toEqual({
      name: '${{ matrix.artifact }}',
      path: 'binaries',
    });
    expect(verifyStep?.run).toContain('codesign --verify --strict --verbose=4');
    expect(verifyStep?.run).toContain('codesign --verify --strict -R=notarized --check-notarization "$binary"');
    expect(verifyStep?.run).toContain('codesign --verify --strict -R=notarized --check-notarization "$ahtraces"');
    expect(verifyStep?.run).toContain('"$binary" --version < /dev/null');
    expect(verifyStep?.run).toContain('ahtraces');
    expect(verifyStep?.run).toContain('Autohand Computer Use.app');
    expect(verifyStep?.env?.MACOS_SIGNING_MODE).toBe('${{ needs.prepare.outputs.macos_signing_mode }}');
    expect(verifyStep?.run).toContain('if [ "$MACOS_SIGNING_MODE" = "developer-id" ]');
    expect(verifyStep?.run).toContain('xcrun stapler validate');
    expect(verifyStep?.run).toContain('spctl -a -vv -t exec');
    expect(workflow.jobs.release.needs).toEqual([
      'prepare',
      'build',
      'verify-macos-artifacts',
    ]);
  });

  it('builds, verifies, and publishes alpha packages with the alpha npm dist-tag', () => {
    const steps = loadReleaseSteps();
    const buildStep = steps.find((step) => step.name === 'Build and verify npm package');
    const publishStep = steps.find((step) => step.name === 'Publish to npm');

    expect(buildStep?.if).toBeUndefined();
    expect(buildStep?.run).toContain(
      'npm version "${{ needs.prepare.outputs.version }}" --no-git-tag-version --allow-same-version',
    );
    expect(buildStep?.run).toContain('bun run build');
    expect(buildStep?.run).toContain('npm pack --dry-run');

    expect(publishStep?.if).toBeUndefined();
    expect(publishStep?.env).toEqual({
      NPM_TOKEN: '${{ secrets.NPM_TOKEN }}',
    });
    expect(publishStep?.run).toContain('NPM_DIST_TAG="alpha"');
    expect(publishStep?.run).toContain('npm publish --access public --tag "$NPM_DIST_TAG"');
    expect(publishStep?.run).toContain('NPM_TOKEN is required for npm publishing');
    expect(publishStep?.run).not.toContain('skipping npm publish');
  });
});
