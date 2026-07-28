/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = path.resolve(import.meta.dirname, '../../.github/workflows');

interface WorkflowJob {
  workflow: string;
  name: string;
  body: string;
}

/** Split every workflow into its top-level jobs, keyed by `<file>:<job>`. */
function readWorkflowJobs(): WorkflowJob[] {
  const jobs: WorkflowJob[] = [];

  for (const file of readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'))) {
    const contents = readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
    const jobsIndex = contents.indexOf('\njobs:');
    if (jobsIndex === -1) continue;

    const body = contents.slice(jobsIndex);
    // Job names sit at exactly two spaces of indentation under `jobs:`.
    const headers = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):$/gmu)];
    for (const [index, header] of headers.entries()) {
      const start = header.index!;
      const end = headers[index + 1]?.index ?? body.length;
      jobs.push({ workflow: file, name: header[1]!, body: body.slice(start, end) });
    }
  }

  return jobs;
}

function hasFullHistoryCheckout(job: WorkflowJob): boolean {
  return /actions\/checkout@v\d+\s*\n\s*with:\s*\n(?:\s*#[^\n]*\n)*\s*fetch-depth:\s*0/u.test(job.body);
}

/**
 * Regression: the Tuistory suite asserts the CLI renders the latest stable
 * release tag, which it discovers with `git tag --merged HEAD`. actions/checkout
 * fetches no tags by default, so those jobs failed in CI while passing locally
 * against a full clone. This was originally fixed in ci.yml alone, and the
 * release workflow kept failing because it runs the same suite from its own job.
 */
describe('CI workflow checkout', () => {
  it('finds at least one job running the built terminal tests', () => {
    const tuistoryJobs = readWorkflowJobs().filter((job) => job.body.includes('test:tuistory'));
    expect(tuistoryJobs.length).toBeGreaterThan(0);
  });

  it('fetches full history in every job that runs the built terminal tests', () => {
    const offenders = readWorkflowJobs()
      .filter((job) => job.body.includes('test:tuistory'))
      .filter((job) => !hasFullHistoryCheckout(job))
      .map((job) => `${job.workflow}:${job.name}`);

    expect(offenders).toEqual([]);
  });

  it('runs built terminal tests in dedicated jobs, separate from fast tests', () => {
    for (const workflow of ['ci.yml', 'release.yml']) {
      const workflowJobs = readWorkflowJobs().filter((job) => job.workflow === workflow);
      const tuistoryJobs = workflowJobs.filter((job) => job.body.includes('test:tuistory'));

      expect(tuistoryJobs.map((job) => job.name), workflow).toEqual(['tuistory']);
      expect(tuistoryJobs[0]?.body, workflow).not.toContain('run: bun run test:ci');
      expect(tuistoryJobs[0]?.body, workflow).not.toMatch(/run: bun run test\s*$/mu);
    }
  });

  it('keeps every checkout pinned to a major version', () => {
    for (const file of readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'))) {
      const contents = readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
      for (const checkout of contents.match(/actions\/checkout@[^\s]+/gu) ?? []) {
        expect(checkout, `${file} pins ${checkout}`).toMatch(/actions\/checkout@v\d+$/u);
      }
    }
  });
});
