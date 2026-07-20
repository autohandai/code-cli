/**
 * Build the instruction used for every autonomous-loop iteration.
 * Kept separate from AutomodeManager so CLI and RPC entry points share the
 * exact contract without eagerly loading the manager's runtime dependencies.
 */
export function buildAutomodeIterationPrompt(
  taskPrompt: string,
  iteration: number,
): string {
  return `# Auto-Mode Task (Iteration ${iteration})

## Original Task
${taskPrompt}

## Instructions
You are running in auto-mode, an autonomous development loop. Continue working on the task above.

1. Review your previous work (check git log, file changes, test results)
2. Identify what remains to be done
3. Make progress on the task
4. If the task is complete, output: <promise>DONE</promise>

IMPORTANT: Only output <promise>DONE</promise> when ALL requirements are fully met.
Do not stop early - keep improving until the task is truly complete.`;
}
