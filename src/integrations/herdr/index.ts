/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HookContext } from '../../core/HookManager.js';
import { resolveHerdrEnvironment } from './environment.js';
import { HerdrReporter, type HerdrCommandRunner } from './reporter.js';
import { deriveHerdrTransition, INITIAL_HERDR_PANE_STATE, type HerdrPaneState } from './stateMachine.js';

export { resolveHerdrEnvironment } from './environment.js';
export { HerdrReporter } from './reporter.js';
export { deriveHerdrTransition } from './stateMachine.js';

export interface HerdrLifecycleSource {
  subscribeLifecycle(listener: (context: Readonly<HookContext>) => void): () => void;
}

export interface AttachHerdrIntegrationOptions {
  hookManager: HerdrLifecycleSource;
  env?: NodeJS.ProcessEnv;
  run?: HerdrCommandRunner;
  now?: () => number;
}

export interface HerdrIntegration {
  reporter: HerdrReporter;
  detach(): void;
}

/**
 * Reports Autohand's state, session, and resume command to the Herdr pane
 * that runs it, following https://herdr.dev/docs/add-herdr-support/.
 * Returns null outside Herdr so the integration costs nothing there.
 */
export function attachHerdrIntegration(options: AttachHerdrIntegrationOptions): HerdrIntegration | null {
  const environment = resolveHerdrEnvironment(options.env ?? process.env);
  if (!environment) return null;

  const reporter = new HerdrReporter({ environment, run: options.run, now: options.now });
  let paneState: HerdrPaneState = INITIAL_HERDR_PANE_STATE;
  const detach = options.hookManager.subscribeLifecycle((context) => {
    const transition = deriveHerdrTransition(paneState, context);
    paneState = transition.next;
    if (transition.report) reporter.report(transition.report);
  });
  return { reporter, detach };
}
