export const DEFAULT_SUBAGENT_MAX_ITERATIONS = 30;
export const MAX_SUBAGENT_ITERATIONS = 1000;

export function isValidSubagentIterationLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_SUBAGENT_ITERATIONS;
}

export function resolveSubagentIterationLimit(definition: number | undefined, configured: number | undefined, requested?: number): number {
  const limit = definition ?? configured ?? DEFAULT_SUBAGENT_MAX_ITERATIONS;
  if (!isValidSubagentIterationLimit(limit) || (requested !== undefined && !isValidSubagentIterationLimit(requested))) {
    throw new RangeError(`Sub-agent iteration limit must be an integer between 1 and ${MAX_SUBAGENT_ITERATIONS}.`);
  }
  return Math.min(limit, requested ?? limit);
}
