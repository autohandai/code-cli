import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentProgramStatus, type ProgramStatusReport } from '../../../src/core/agent/AgentProgramStatus.js';
import type { CLIOptions } from '../../../src/types.js';
import { confirmAgentDangerousAction, executeAgentAskFollowupQuestion, requestAgentDirectoryAccess } from '../../../src/core/agent/AgentCommandRuntime.js';

afterEach(() => vi.unstubAllEnvs());

function harness() {
  const reports: ProgramStatusReport[] = [];
  const status = new AgentProgramStatus({ id: 'autohand-test', enabled: false, write: vi.fn(), onChange: report => reports.push(report) });
  const host = {
    runtime: { options: {} as CLIOptions, config: { ui: {} } },
    confirmationCallback: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
    directoryAccessCallback: vi.fn().mockResolvedValue('/other'),
    followupQuestionCallback: vi.fn().mockResolvedValue('Staging'),
    permissionManager: { applyPromptDecision: vi.fn().mockResolvedValue(undefined) },
    hookManager: { executeHooks: vi.fn().mockResolvedValue([]) },
    notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
    getNotificationGuards: () => ({}),
    withModalPause: <T>(callback: () => Promise<T>) => status.prompt('Waiting for input', callback),
  };
  return { status, host, reports };
}

describe('program status at actual prompt boundaries', () => {
  it.each(['confirmation', 'directory', 'question'] as const)('reports the actual %s wait and resumes after the answer', async flow => {
    vi.stubEnv('CI', 'false');
    vi.stubEnv('AUTOHAND_NON_INTERACTIVE', '0');
    const { status, host, reports } = harness();
    await status.run(async () => {
      if (flow === 'confirmation') await confirmAgentDangerousAction(host, 'Run a tool?');
      if (flow === 'directory') await requestAgentDirectoryAccess(host, '/other', 'Read shared sources');
      if (flow === 'question') await executeAgentAskFollowupQuestion(host, 'Which environment?');
      return true;
    });
    expect(reports.map(report => report.state)).toEqual(['working', 'blocked', 'working', 'done']);
    expect(reports[1]).toMatchObject({ kind: flow === 'question' ? 'question' : 'permission' });
  });

  it('does not report blocked for automatically approved actions or questions', async () => {
    const { status, host, reports } = harness();
    host.runtime.options = { yes: true };
    await status.run(async () => {
      await confirmAgentDangerousAction(host, 'Run a tool?');
      await requestAgentDirectoryAccess(host, '/other');
      await executeAgentAskFollowupQuestion(host, 'Continue?');
      return true;
    });
    expect(reports.map(report => report.state)).toEqual(['working', 'done']);
  });

  it('unwinds the blocked state when a remote permission callback fails', async () => {
    const { status, host, reports } = harness();
    host.confirmationCallback.mockRejectedValue(new Error('transport lost'));
    await expect(status.run(() => confirmAgentDangerousAction(host, 'Approve?'))).rejects.toThrow('transport lost');
    expect(reports.map(report => report.state)).toEqual(['working', 'blocked', 'working', 'error']);
  });
});
