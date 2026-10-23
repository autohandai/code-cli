/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RunToolScope } from '../permissions/runToolScope.js';
import { REVIEW_INSPECTION_SCOPE } from './reviewToolScope.js';
import type { ReviewRequest } from './reviewRequest.js';

export type ReviewExecutionSurface = 'interactive' | 'cli' | 'acp' | 'json_rpc';
export type ReviewLifecycleEvent =
  | 'review:start'
  | 'review:end'
  | 'review:paused'
  | 'review:failed'
  | 'review:completed';
export type ReviewLifecycleStatus = 'running' | 'completed' | 'failed' | 'paused';

export interface ReviewLifecycleContext {
  sessionId?: string;
  duration?: number;
  success?: boolean;
  reviewPath?: string;
  reviewScope: string;
  reviewInstructions?: string;
  reviewError?: string;
  reviewAudience: ReviewRequest['audience'];
  reviewBase?: string;
  reviewFormat: ReviewRequest['format'];
  reviewHead?: string;
  reviewKind: ReviewRequest['kind'];
  reviewStatus: ReviewLifecycleStatus;
  reviewSurface: ReviewExecutionSurface;
}

export interface ReviewHookExecutor {
  executeHooks(
    event: ReviewLifecycleEvent,
    context: ReviewLifecycleContext,
  ): Promise<unknown>;
}

export type ReviewPermissionMode = 'interactive' | 'unrestricted' | 'restricted' | 'external';

export interface ReviewPermissionManager {
  addRunToolScope?(scope: RunToolScope): () => void;
  getMode(): ReviewPermissionMode;
  setMode(mode: ReviewPermissionMode): void;
  beginReadOnlyReview?(): () => void;
}

export interface ReviewLifecycleExecution {
  request: ReviewRequest;
  surface: ReviewExecutionSurface;
  hookManager?: ReviewHookExecutor;
  permissionManager?: ReviewPermissionManager;
  sessionId?: string;
  signal?: AbortSignal;
  onEvent?: (
    event: ReviewLifecycleEvent,
    context: ReviewLifecycleContext,
  ) => void | Promise<void>;
  execute(signal?: AbortSignal): Promise<boolean>;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
    || (error instanceof Error && error.name === 'AbortError');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeReviewWithLifecycle(
  execution: ReviewLifecycleExecution,
): Promise<boolean> {
  const startedAt = Date.now();
  let status: ReviewLifecycleStatus = 'running';
  let failure: string | undefined;
  let previousPermissionMode: ReviewPermissionMode | undefined;
  let releaseInspectionScope: (() => void) | undefined;
  let restoreReadOnlyScope: (() => void) | undefined;

  const context = (includeOutcome: boolean): ReviewLifecycleContext => ({
    ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
    ...(includeOutcome ? { duration: Math.max(0, Date.now() - startedAt) } : {}),
    ...(includeOutcome ? { success: status === 'completed' } : {}),
    ...(execution.request.target ? { reviewPath: execution.request.target } : {}),
    reviewScope: execution.request.kind,
    ...(execution.request.focus ? { reviewInstructions: execution.request.focus } : {}),
    ...(failure ? { reviewError: failure } : {}),
    reviewAudience: execution.request.audience,
    ...(execution.request.base ? { reviewBase: execution.request.base } : {}),
    reviewFormat: execution.request.format,
    ...(execution.request.head ? { reviewHead: execution.request.head } : {}),
    reviewKind: execution.request.kind,
    reviewStatus: status,
    reviewSurface: execution.surface,
  });

  const notify = async (event: ReviewLifecycleEvent, includeOutcome = false): Promise<void> => {
    const payload = context(includeOutcome);
    const observers: Promise<unknown>[] = [];
    if (execution.hookManager) {
      observers.push(execution.hookManager.executeHooks(event, payload));
    }
    if (execution.onEvent) {
      observers.push(Promise.resolve(execution.onEvent(event, payload)));
    }
    await Promise.allSettled(observers);
  };

  await notify('review:start');
  try {
    if (execution.permissionManager?.addRunToolScope) {
      releaseInspectionScope = execution.permissionManager.addRunToolScope(REVIEW_INSPECTION_SCOPE);
    } else if (execution.permissionManager) {
      previousPermissionMode = execution.permissionManager.getMode();
      if (previousPermissionMode !== 'restricted') {
        execution.permissionManager.setMode('restricted');
      }
    }
    restoreReadOnlyScope = execution.permissionManager?.beginReadOnlyReview?.();

    if (execution.signal?.aborted) {
      status = 'paused';
      await notify('review:paused', true);
      return false;
    }

    const succeeded = await execution.execute(execution.signal);
    if (execution.signal?.aborted) {
      status = 'paused';
      await notify('review:paused', true);
      return false;
    }

    if (succeeded) {
      status = 'completed';
      await notify('review:completed', true);
      return true;
    }

    status = 'failed';
    failure = 'Review execution did not complete.';
    await notify('review:failed', true);
    return false;
  } catch (error) {
    if (isAbort(error, execution.signal)) {
      status = 'paused';
      await notify('review:paused', true);
      return false;
    }

    status = 'failed';
    failure = errorMessage(error);
    await notify('review:failed', true);
    throw error;
  } finally {
    try {
      await notify('review:end', true);
    } finally {
      releaseInspectionScope?.();
      restoreReadOnlyScope?.();
      if (execution.permissionManager && previousPermissionMode !== undefined
        && previousPermissionMode !== 'restricted') {
        execution.permissionManager.setMode(previousPermissionMode);
      }
    }
  }
}
