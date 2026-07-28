/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = path.resolve(import.meta.dirname, '../../.github/workflows/ci.yml');

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

/**
 * Regression: the Tuistory suite asserts the CLI renders the latest stable
 * release tag, which it discovers with `git tag --merged HEAD`. actions/checkout
 * fetches no tags by default, so the job failed in CI while passing locally
 * against a full clone.
 */
describe('CI workflow checkout', () => {
  it('fetches full history for the job that runs the built terminal tests', () => {
    const workflow = readWorkflow();
    const testJob = workflow.slice(
      workflow.indexOf('  test:'),
      workflow.indexOf('  build-test:'),
    );

    expect(testJob).toContain('bun run test:tuistory');
    expect(testJob).toMatch(/actions\/checkout@v\d+\s*\n\s*with:\s*\n(?:\s*#[^\n]*\n)*\s*fetch-depth:\s*0/);
  });

  it('keeps every checkout in the workflow pinned to a major version', () => {
    const checkouts = readWorkflow().match(/actions\/checkout@v\d+/g) ?? [];

    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) {
      expect(checkout).toMatch(/actions\/checkout@v\d+$/);
    }
  });
});
