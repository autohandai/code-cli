/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

interface WorkflowStep {
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
}

interface ReleaseWorkflow {
  jobs: {
    release: {
      steps: WorkflowStep[];
    };
  };
}

const WORKFLOW_PATH = path.resolve(import.meta.dirname, '../../.github/workflows/release.yml');

function loadReleaseSteps(): WorkflowStep[] {
  const workflow = parseYaml(readFileSync(WORKFLOW_PATH, 'utf8')) as ReleaseWorkflow;
  return workflow.jobs.release.steps;
}

describe('release workflow', () => {
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
