/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

interface WorkflowStep {
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  needs?: string[];
  'runs-on'?: string;
  strategy?: {
    matrix?: {
      artifact?: string[];
      include?: Array<{
        os: string;
        target?: string;
        artifact: string;
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

function loadReleaseWorkflow(): ReleaseWorkflow {
  return parseYaml(readFileSync(WORKFLOW_PATH, 'utf8')) as ReleaseWorkflow;
}

function loadReleaseSteps(): WorkflowStep[] {
  return loadReleaseWorkflow().jobs.release.steps;
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
    const compileIndex = buildSteps.findIndex((step) => step.name === 'Compile binary');
    const signIndex = buildSteps.findIndex((step) => step.name === 'Sign macOS binary');
    const smokeIndex = buildSteps.findIndex((step) => step.name === 'Smoke test binary');
    const uploadIndex = buildSteps.findIndex((step) => step.name === 'Upload artifact');
    const signStep = buildSteps[signIndex];

    expect(compileIndex).toBeGreaterThanOrEqual(0);
    expect(signIndex).toBeGreaterThan(compileIndex);
    expect(smokeIndex).toBeGreaterThan(signIndex);
    expect(uploadIndex).toBeGreaterThan(smokeIndex);
    expect(signStep?.if).toBe("runner.os == 'macOS'");
    expect(signStep?.run).toContain('codesign --force --sign - --timestamp=none');
    expect(signStep?.run).toContain('codesign --verify --strict --verbose=4');
    expect(buildTargets).toEqual(expect.arrayContaining([
      {
        os: 'macos-latest',
        target: 'darwin-arm64',
        artifact: 'autohand-macos-arm64',
      },
      {
        os: 'macos-15-intel',
        target: 'darwin-x64',
        artifact: 'autohand-macos-x64',
      },
    ]));

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
      { os: 'macos-latest', artifact: 'autohand-macos-arm64' },
      { os: 'macos-15-intel', artifact: 'autohand-macos-x64' },
    ]);
    expect(downloadStep?.uses).toBe('actions/download-artifact@v8');
    expect(downloadStep?.with).toEqual({
      name: '${{ matrix.artifact }}',
      path: 'binaries',
    });
    expect(verifyStep?.run).toContain('codesign --verify --strict --verbose=4');
    expect(verifyStep?.run).toContain('"$binary" --version < /dev/null');
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
