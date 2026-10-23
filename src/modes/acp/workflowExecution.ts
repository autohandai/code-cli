/** Native execution is explicit metadata, never inferred from host-wrapped context. */
export interface WorkflowReviewExecution {
  readonly type: 'review';
  readonly arguments: string;
}

export interface WorkflowGoalExecution {
  readonly type: 'goal';
  readonly executionId: string;
}

export function parseWorkflowExecution(value: unknown): WorkflowReviewExecution | WorkflowGoalExecution | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid workflow execution descriptor.');
  }
  const descriptor = value as Record<string, unknown>;
  if (descriptor.type === 'goal' && typeof descriptor.executionId === 'string'
      && /^[A-Za-z0-9:_-]{1,256}$/.test(descriptor.executionId)
      && Object.keys(descriptor).every(key => key === 'type' || key === 'executionId')) {
    return { type: 'goal', executionId: descriptor.executionId };
  }
  if (descriptor.type !== 'review' || typeof descriptor.arguments !== 'string'
      || descriptor.arguments.length > 65536
      || Object.keys(descriptor).some(key => key !== 'type' && key !== 'arguments')) {
    throw new Error('Unsupported workflow execution descriptor.');
  }
  return { type: 'review', arguments: descriptor.arguments };
}
