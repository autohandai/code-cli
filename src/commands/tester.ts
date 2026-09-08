/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureVisualEvidence, parseVisualEvidenceSteps, type VisualEvidenceStep } from '../testing/visualEvidence.js';
import { runProjectTestScript } from '../testing/projectTestRun.js';
import { lifecycleDelegation, startLifecycleWorkflow, type LifecycleCommandContext } from './lifecycleWorkflow.js';

export interface TesterCommandContext extends LifecycleCommandContext {
  runCancellableOperation?<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

export const metadata = {
  command: '/tester',
  description: 'plan verification, run project tests, and capture real browser evidence',
  implemented: true,
  subcommands: [
    { name: 'run', description: 'Execute a declared package.json test script and save exit/log evidence' },
    { name: 'capture', description: 'Capture localhost Playwright screenshots, trace, and animated WebP' },
    { name: 'help', description: 'Show test and visual evidence usage' },
  ],
};

const usage = [
  'Usage: /tester [acceptance criteria or scope]',
  '/tester run <package.json script> [-- arguments] — executes the selected project script (120 second limit).',
  '/tester capture <localhost-url> [scenario.json] — uses existing project Playwright and browser installations only.',
  'Scenario JSON is an array of click/fill/press/waitFor steps with selectors; files must stay inside the workspace.',
  'Artifacts: .autohand/test-evidence/run-*/report.md, manifest.json, log or PNG frames, trace.zip, and animated WebP.',
  'No packages or browsers are downloaded. Capture is not visual inspection or a substitute for assertions.',
].join('\n');

async function cancellable<T>(ctx: TesterCommandContext, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (ctx.runCancellableOperation) return ctx.runCancellableOperation(operation);
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once('SIGINT', interrupt);
  try {
    return await operation(controller.signal);
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
}

async function readScenario(workspaceRoot: string, relativePath: string): Promise<VisualEvidenceStep[]> {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error('Scenario file must stay inside the workspace.');
  }
  const root = await fs.realpath(workspaceRoot);
  const resolved = await fs.realpath(path.resolve(root, relativePath));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Scenario file must stay inside the workspace.');
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > 65_536) throw new Error('Scenario must be a JSON file no larger than 64 KiB.');
  const contents = await fs.readFile(resolved, 'utf8');
  if (Buffer.byteLength(contents) > 65_536) throw new Error('Scenario must be a JSON file no larger than 64 KiB.');
  return parseVisualEvidenceSteps(JSON.parse(contents) as unknown);
}

export async function tester(ctx: TesterCommandContext, args: string[] = []): Promise<string | null> {
  const [action, ...rest] = args;
  if (action === 'help' || action === '--help') return usage;
  try {
    if (action === 'run') {
      const [script, ...scriptArgs] = rest;
      if (!script) return usage;
      const result = await cancellable(ctx, signal => runProjectTestScript({
        workspaceRoot: ctx.workspaceRoot,
        script,
        args: scriptArgs[0] === '--' ? scriptArgs.slice(1) : scriptArgs,
        signal,
      }));
      return [
        `Project script: ${result.status}`,
        `Exit code: ${result.exitCode ?? 'not available'}`,
        `Visual inspection: ${result.visualInspection}`,
        result.message,
        `Evidence: [report.md](<${result.reportPath}>)`,
        `Manifest: [manifest.json](<${result.manifestPath}>)`,
      ].join('\n');
    }
    if (action === 'capture') {
      const [url, scenarioPath, extra] = rest;
      if (!url || extra) return usage;
      const steps = scenarioPath ? await readScenario(ctx.workspaceRoot, scenarioPath) : undefined;
      const result = await cancellable(ctx, signal => captureVisualEvidence({ workspaceRoot: ctx.workspaceRoot, url, steps, signal }));
      return [
        `Browser capture: ${result.capture}`,
        `Visual inspection: ${result.visualInspection}`,
        result.message,
        `Evidence: [report.md](<${result.reportPath}>)`,
        `Manifest: [manifest.json](<${result.manifestPath}>)`,
        ...(result.animationPath ? [`Animation: [animated WebP](<${result.animationPath}>)`] : []),
        'Open and inspect the retained frames before claiming visual confirmation. Playwright assertions and project test results remain separate.',
      ].join('\n');
    }
  } catch (error) {
    return `Tester not completed: ${error instanceof Error ? error.message : String(error)}`;
  }
  const scope = args.join(' ').trim() || 'current changes and their user-visible acceptance criteria';
  const prompt = [
    'Act as an evidence-driven software tester across requirements, implementation, validation, and release readiness.',
    `Workspace: ${ctx.workspaceRoot}`,
    `Scope: ${scope}`,
    'Read project instructions, the target implementation, and existing tests. Translate plain-language user outcomes into observable acceptance criteria; ask only for missing decisions that materially change expected behavior. Use requirements-translator or software-architect for ambiguous product intent, and tester for executable verification.',
    lifecycleDelegation,
    'Identify the installed project framework and its configured commands. Run the smallest relevant real tests first, then relevant integration/lint/typecheck/proof checks. A bug fix starts with a reproducing failure; do not rewrite assertions merely to obtain green.',
    'Use existing project dependencies; do not download packages, install browsers, or invoke npx as an automatic fallback. Report missing prerequisites as not-run with exact setup needed for the user to authorize.',
    'For web UI, author focused Playwright assertions for the actual user journey, keyboard navigation, responsive states, and meaningful errors. Run them against the intended local app. Retain test results, screenshots, and traces.',
    'For visual proof, call capture_test_evidence with the intended localhost URL and bounded interaction steps after the app is running; this produces actual PNG frames, Playwright trace, animated WebP, and an evidence manifest. A capture-only clip is not a passed assertion suite.',
    'Visual confirmation means the relevant screenshot or animation was actually opened and inspected. Record what was inspected, expected versus observed states, and limitations. If no image-viewing capability is available, mark visual inspection not-run and hand the artifacts to the user.',
    'If capture_test_evidence is unavailable or approval is denied, give the user the exact /tester capture <localhost-url> [scenario.json] command; do not claim that artifacts were generated. The user may run /tester run <package script> to retain command/exit/log evidence.',
    'Keep requested scope and unrelated user changes intact. Do not commit, publish artifacts externally, or run production/destructive tests without explicit authorization.',
    'Finish with a concise acceptance matrix: criterion, passed/failed/not-run, exact command or artifact, and reason for any gap. Separate project test execution, browser capture, and visual inspection. Explain remaining user impact in plain language with technical file references where useful.',
  ].join('\n\n');
  return startLifecycleWorkflow(ctx, prompt, 'Starting evidence-driven testing...');
}
