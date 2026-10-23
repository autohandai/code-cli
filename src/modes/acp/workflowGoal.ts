import { GoalManager } from '../../goals/GoalManager.js';

/** Observe native durable state; a model answer alone never completes a workflow goal. */
export async function continueWorkflowGoal(options: {
  manager: GoalManager;
  goalId: string;
  signal: AbortSignal;
  runTurn: (turn: number) => Promise<void>;
}): Promise<void> {
  const { manager, goalId, signal, runTurn } = options;
  try {
    for (let turn = 0; ; turn++) {
      signal.throwIfAborted();
      const snapshot = await manager.getSessionSnapshot();
      if (snapshot.storageError) throw new Error(snapshot.storageError);
      // Completion can advance the queue before the turn returns. Never follow its successor.
      const completed = snapshot.completed.find(goal => goal.goalId === goalId
        && goal.sessionId === snapshot.sessionId);
      if (completed?.status === 'complete') return;
      const goal = snapshot.goal;
      if (!goal || goal.goalId !== goalId) {
        throw new Error('The workflow goal was cleared or replaced before completion.');
      }
      if (goal.status === 'complete') return;
      if (goal.status !== 'active') throw new Error(`The workflow goal is ${goal.status}; the step has not completed.`);
      await runTurn(turn);
    }
  } finally {
    const snapshot = await manager.getSessionSnapshot();
    if (snapshot.goal?.goalId === goalId && snapshot.goal.status === 'active') {
      // Identity is checked again under the mutation lock, protecting replacements.
      const result = await manager.updateGoal({ status: 'paused', expectedGoalId: goalId, expectedStatus: 'active' });
      if (!result.ok && result.goal?.goalId === goalId && result.goal.status === 'active') {
        throw new Error(result.message ?? 'Could not pause the workflow goal.');
      }
    }
  }
}

/** Goal execution is explicitly requested by the host; its feature override is run-only. */
export async function withWorkflowGoalConfig<T>(config: import('../../types.js').AutohandConfig & {
  runOverlay?: import('../../types.js').RunConfigOverlaySnapshot;
}, execute: () => Promise<T>): Promise<T> {
  const { applyRunConfigOverlay, restoreRunConfigOverlay } = await import('../../runConfigOverlay.js');
  const previous = config.runOverlay;
  const overlay = applyRunConfigOverlay(config, { sets: ['features.slashGoal=true', 'agent.goalAutoMode=false'] });
  config.features = overlay.config.features;
  config.agent = overlay.config.agent;
  config.runOverlay = { entries: [...(previous?.entries ?? []), ...(overlay.snapshot?.entries ?? [])] };
  try {
    return await execute();
  } finally {
    if (overlay.snapshot) restoreRunConfigOverlay(config as unknown as Record<string, unknown>, overlay.snapshot);
    if (previous) config.runOverlay = previous;
    else delete config.runOverlay;
  }
}

export async function executeWorkflowGoal(options: {
  workspaceRoot: string;
  sessionId: string;
  executionId: string;
  instruction: string;
  signal: AbortSignal;
  runTurn: (instruction: string) => Promise<void>;
}): Promise<void> {
  if (!options.sessionId.trim()) throw new Error('A workflow goal requires a persistent session.');
  options.signal.throwIfAborted();
  const manager = new GoalManager(options.workspaceRoot, { sessionId: options.sessionId });
  const marker = `Workflow execution ${options.executionId}:\n`;
  const objective = `${marker}${options.instruction}`;
  const snapshot = await manager.getSessionSnapshot();
  if (snapshot.storageError) throw new Error(snapshot.storageError);
  if (snapshot.completed.some(goal => goal.sessionId === options.sessionId
      && goal.objective.startsWith(marker) && goal.status === 'complete')) return;
  let goal = snapshot.goal?.objective.startsWith(marker) ? snapshot.goal : undefined;
  if (!goal) {
    const result = await manager.createGoal({ objective });
    if (!result.ok || !result.goal) throw new Error(result.message ?? 'Could not create the workflow goal.');
    goal = result.goal;
  }
  await continueWorkflowGoal({
    manager, goalId: goal.goalId, signal: options.signal,
    runTurn: async turn => {
      await options.runTurn([
        `Continue persistent workflow goal ${goal.goalId}.`,
        'Use get_goal to inspect its objective and update_goal only when the full objective is achieved.',
        'An ordinary answer does not complete this workflow step. Do not create or switch to another goal.',
        `Workflow turn ${turn + 1}.`,
        goal.objective.slice(marker.length),
      ].join('\n\n'));
    },
  });
}
