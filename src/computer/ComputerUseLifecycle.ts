import { randomUUID } from 'node:crypto';
import type { HookContext, HookManager } from '../core/HookManager.js';
import { computerUseStepLabel, computerUseStepResult, COMPUTER_USE_TOOL_PREFIX } from './computerUseOutput.js';

type ActionContext = Pick<HookContext, 'tool' | 'toolCallId' | 'args' | 'success' | 'output' | 'error' | 'duration'>;
type RunStatus = 'finished' | 'failed' | 'cancelled';

interface ComputerUseRun {
  id: string;
  startedAt: number;
  actions: number;
  started: Promise<void>;
}

export class ComputerUseLifecycle {
  private run?: ComputerUseRun;

  constructor(private readonly hooks: Pick<HookManager, 'executeHooks'>) {}

  async startAction(context: ActionContext): Promise<void> {
    if (!context.tool?.startsWith(COMPUTER_USE_TOOL_PREFIX)) return;
    if (!this.run) {
      const id = randomUUID();
      this.run = { id, startedAt: Date.now(), actions: 0,
        started: this.emit('computer-use-start', { computerUseId: id, computerUseStatus: 'running', ...context }),
      };
    }
    const run = this.run;
    run.actions++;
    await run.started;
    if (this.run !== run) return;
    await this.emit('computer-use-progress', {
      ...context, computerUseId: run.id, computerUseStatus: 'running',
      computerUseAction: computerUseStepLabel(context.tool, context.args ?? {}),
    });
  }

  async finishAction(context: ActionContext, aborted: boolean): Promise<void> {
    if (!context.tool?.startsWith(COMPUTER_USE_TOOL_PREFIX) || !this.run) return;
    const status = aborted ? 'cancelled' : computerUseStepResult(context.success === true, context.output ?? '').status;
    const actionContext = {
      ...context, computerUseId: this.run.id, computerUseStatus: status,
      computerUseAction: computerUseStepLabel(context.tool, context.args ?? {}),
    };
    await this.emit('computer-use-progress', actionContext);
    if (status === 'failed') {
      await this.emit('computer-use-error', {
        ...actionContext, error: context.error?.trim() || context.output?.trim() || 'Computer Use action failed.',
      });
    }
  }

  async finish(status: RunStatus): Promise<void> {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    await run.started;
    await this.emit('computer-use-stop', {
      computerUseId: run.id, computerUseStatus: status,
      toolCallsCount: run.actions, duration: Date.now() - run.startedAt,
    });
  }

  private async emit(event: 'computer-use-start' | 'computer-use-progress' | 'computer-use-error' | 'computer-use-stop', context: Omit<HookContext, 'event' | 'workspace'>): Promise<void> {
    try {
      await this.hooks.executeHooks(event, context, { signal: AbortSignal.timeout(5_000) });
    } catch {
      // Observers cannot replace an action's outcome or interrupt final cleanup.
    }
  }
}
