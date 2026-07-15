/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractDeepResearchRunId,
  finalizeDeepResearchRun,
  markDeepResearchRunStarted,
  readDeepResearchRun,
  startDeepResearchRun,
} from '../../src/deepResearch/session.js';
import type { SessionMessage } from '../../src/session/types.js';

describe('deep research session lifecycle', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-deep-research-session-'));
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('persists a queued run and recognizes its instruction marker', async () => {
    const run = await startDeepResearchRun({
      workspaceRoot,
      topic: 'Hermes and DSPy',
      reportPath: '.autohand/research/topic-hermes-and-dspy.md',
      sessionId: 'session-1',
    });

    expect(run.status).toBe('queued');
    expect(extractDeepResearchRunId(`AUTOHAND_DEEP_RESEARCH_RUN_ID: ${run.id}`)).toBe(run.id);
    await markDeepResearchRunStarted(workspaceRoot, run.id);
    await expect(readDeepResearchRun(workspaceRoot)).resolves.toMatchObject({
      id: run.id,
      status: 'running',
      topic: 'Hermes and DSPy',
    });
  });

  it('does not complete when the report was never written', async () => {
    const run = await startDeepResearchRun({
      workspaceRoot,
      topic: 'Hermes and DSPy',
      reportPath: '.autohand/research/topic-hermes-and-dspy.md',
    });
    await markDeepResearchRunStarted(workspaceRoot, run.id);

    const completion = await finalizeDeepResearchRun({
      workspaceRoot,
      runId: run.id,
      turnSucceeded: true,
      qualityPassed: true,
      finalResponse: 'Completed the investigation.',
      messages: [],
    });

    expect(completion.completed).toBe(false);
    expect(completion.blockers).toContain('The report has not been written.');
    await expect(readDeepResearchRun(workspaceRoot)).resolves.toMatchObject({
      status: 'incomplete',
      blockers: expect.arrayContaining(['The report has not been written.']),
    });
  });

  it('does not complete while the latest research task list has unfinished work', async () => {
    const run = await startDeepResearchRun({
      workspaceRoot,
      topic: 'Hermes and DSPy',
      reportPath: '.autohand/research/topic-hermes-and-dspy.md',
    });
    await fs.outputFile(path.join(workspaceRoot, run.reportPath), validReport());
    const messages = [todoMessage([
      { title: 'Gather sources', status: 'completed' },
      { title: 'Cross-check findings', status: 'in_progress' },
    ])];

    const completion = await finalizeDeepResearchRun({
      workspaceRoot,
      runId: run.id,
      turnSucceeded: true,
      qualityPassed: true,
      finalResponse: `Research saved: ${run.reportPath}`,
      messages,
    });

    expect(completion.completed).toBe(false);
    expect(completion.blockers).toContain('Research tasks remain unfinished (1 of 2 completed).');
  });

  it('does not complete when project quality checks fail', async () => {
    const run = await startDeepResearchRun({
      workspaceRoot,
      topic: 'Hermes and DSPy',
      reportPath: '.autohand/research/topic-hermes-and-dspy.md',
    });
    await fs.outputFile(path.join(workspaceRoot, run.reportPath), validReport());

    const completion = await finalizeDeepResearchRun({
      workspaceRoot,
      runId: run.id,
      turnSucceeded: true,
      qualityPassed: false,
      finalResponse: `Research saved: ${run.reportPath}`,
      messages: [todoMessage([{ title: 'Finish report', status: 'completed' }])],
    });

    expect(completion.completed).toBe(false);
    expect(completion.blockers).toContain('Project quality checks failed.');
  });

  it('does not complete when the report lacks cited evidence and required sections', async () => {
    const run = await startDeepResearchRun({
      workspaceRoot,
      topic: 'Hermes and DSPy',
      reportPath: '.autohand/research/topic-hermes-and-dspy.md',
    });
    await fs.outputFile(
      path.join(workspaceRoot, run.reportPath),
      '# Hermes and DSPy\n\n## Summary\nA short uncited answer.\n',
    );

    const completion = await finalizeDeepResearchRun({
      workspaceRoot,
      runId: run.id,
      turnSucceeded: true,
      qualityPassed: true,
      finalResponse: `Research saved: ${run.reportPath}`,
      messages: [todoMessage([{ title: 'Finish report', status: 'completed' }])],
    });

    expect(completion.completed).toBe(false);
    expect(completion.blockers).toEqual(expect.arrayContaining([
      'The report is missing a Findings section.',
      'The report is missing an Open questions / uncertainty section.',
      'The report is missing a Sources section.',
      'The report needs at least two inline source citations.',
      'The Sources section needs at least two numbered URLs.',
    ]));
  });

  it('marks a run complete only when the full contract is proven', async () => {
    const run = await startDeepResearchRun({
      workspaceRoot,
      topic: 'Hermes and DSPy',
      reportPath: '.autohand/research/topic-hermes-and-dspy.md',
    });
    await fs.outputFile(path.join(workspaceRoot, run.reportPath), validReport());
    const messages = [todoMessage([
      { title: 'Gather sources', status: 'completed' },
      { title: 'Cross-check findings', status: 'completed' },
      { title: 'Write the report', status: 'completed' },
    ])];

    const completion = await finalizeDeepResearchRun({
      workspaceRoot,
      runId: run.id,
      turnSucceeded: true,
      qualityPassed: true,
      finalResponse: `Research saved: ${run.reportPath}`,
      messages,
    });

    expect(completion).toEqual({ completed: true, blockers: [] });
    await expect(readDeepResearchRun(workspaceRoot)).resolves.toMatchObject({
      status: 'completed',
      blockers: [],
      completedAt: expect.any(String),
    });
  });

  it('uses the reserved path and successful lifecycle instead of parsing final prose', async () => {
    const run = await startDeepResearchRun({
      workspaceRoot,
      topic: 'Hermes and DSPy',
      reportPath: '.autohand/research/topic-hermes-and-dspy.md',
    });
    await fs.outputFile(path.join(workspaceRoot, run.reportPath), validReport());

    const completion = await finalizeDeepResearchRun({
      workspaceRoot,
      runId: run.id,
      turnSucceeded: true,
      qualityPassed: true,
      finalResponse: 'The report is ready.',
      messages: [todoMessage([{ title: 'Finish report', status: 'completed' }])],
    });

    expect(completion).toEqual({ completed: true, blockers: [] });
  });
});

function todoMessage(tasks: Array<{ title: string; status: string }>): SessionMessage {
  return {
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
    toolCalls: [{ id: 'todo-1', tool: 'todo_write', args: { tasks } }],
  };
}

function validReport(): string {
  return [
    '# Hermes and DSPy',
    '',
    '## Summary',
    'Hermes iterative refinement and DSPy optimization can be compared as complementary research techniques [1][2].',
    '',
    '## Findings',
    'Hermes uses iterative critique loops supported by primary project evidence [1].',
    'DSPy exposes declarative optimizers documented by its maintainers [2].',
    '',
    '## Open questions / uncertainty',
    'Direct benchmark comparability remains uncertain.',
    '',
    '## Sources',
    '1. Hermes documentation - https://example.com/hermes',
    '2. DSPy documentation - https://example.com/dspy',
  ].join('\n');
}
