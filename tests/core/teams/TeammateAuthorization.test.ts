import { describe, expect, it, vi } from 'vitest';
import { authorizeTeammateTool, createTeammateConfirmation, TeammateAuthorizationBroker } from '../../../src/core/teams/TeammateAuthorization.js';
import { DEFAULT_TOOL_DEFINITIONS } from '../../../src/core/toolManager.js';
import { PermissionManager } from '../../../src/permissions/PermissionManager.js';
import type { HookExecutionResult } from '../../../src/core/HookManager.js';

describe('teammate authorization at the lead', () => {
  it('keeps a lead policy denial authoritative even when confirmations are automatic', async () => {
    const confirmApproval = vi.fn(async () => true);
    const result = await authorizeTeammateTool({
      id: 'write-call', tool: 'write_file', args: { path: 'protected.txt', contents: 'overwrite' },
    }, {
      definitions: DEFAULT_TOOL_DEFINITIONS,
      confirmApproval,
      authorization: { permissionManager: new PermissionManager({
        mode: 'unrestricted', denyPatterns: [{ kind: 'write_file', argument: 'protected.txt' }],
      }) },
    });

    expect(result).toMatchObject({ allowed: false });
    expect(confirmApproval).not.toHaveBeenCalled();
  });

  it('never grants a cancelled or disconnected child request', async () => {
    const send = vi.fn();
    const broker = new TeammateAuthorizationBroker(send);
    const controller = new AbortController();
    const pending = broker.authorize({ tool: 'write_file', toolCallId: 'call', args: { path: 'a.txt', contents: 'x' }, signal: controller.signal },
      { taskId: 'task', runId: 'attempt' });
    controller.abort();
    await expect(pending).rejects.toThrow();
    broker.handleResult({ requestId: send.mock.calls[0][1].requestId, result: { allowed: true, args: {} } });
    broker.disconnect();
    await expect(broker.authorize({ tool: 'read_file', toolCallId: 'next', args: { path: 'a.txt' } },
      { taskId: 'task', runId: 'attempt' })).rejects.toThrow('disconnected');
  });

  it('honors effective restricted context and blocking hooks before automatic confirmation', async () => {
    const call = { id: 'write-call', tool: 'write_file' as const, args: { path: 'a.txt', contents: 'x' } };
    const confirmApproval = vi.fn(async () => true);
    const policy = { definitions: DEFAULT_TOOL_DEFINITIONS, confirmApproval,
      authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) } };
    expect(await authorizeTeammateTool(call, { ...policy, clientContext: 'restricted' })).toMatchObject({ allowed: false });
    expect(await authorizeTeammateTool(call, { ...policy, authorization: {
      ...policy.authorization,
      runPreToolHooks: async () => [{ hook: { event: 'pre-tool', command: 'policy' }, success: true, duration: 0,
        response: { decision: 'block', reason: 'Blocked by the lead hook' } }],
    } })).toEqual({ allowed: false, error: 'Blocked by the lead hook' });
    expect(confirmApproval).not.toHaveBeenCalled();
  });

  it('returns only validated hook-rewritten args after the lead grants permission', async () => {
    const rewrite = (path: unknown): HookExecutionResult[] => [{
      hook: { event: 'pre-tool', command: 'policy' }, success: true, duration: 0,
      response: { updatedInput: { path } },
    }];
    const options = {
      definitions: DEFAULT_TOOL_DEFINITIONS, confirmApproval: vi.fn(async () => true),
      authorization: { permissionManager: new PermissionManager(), runPreToolHooks: async () => rewrite('reviewed.txt') },
    };
    const call = { id: 'write', tool: 'write_file' as const, args: { path: 'original.txt', contents: 'approved' } };
    expect(await authorizeTeammateTool(call, options)).toEqual({ allowed: true, args: { path: 'reviewed.txt', contents: 'approved' } });
    expect(options.confirmApproval).toHaveBeenCalledOnce();
    expect(await authorizeTeammateTool(call, { ...options, authorization: {
      ...options.authorization, runPreToolHooks: async () => rewrite(123),
    } })).toMatchObject({ allowed: false });
  });

  it('does not widen the current lead tool catalogue', async () => {
    expect(await authorizeTeammateTool({ tool: 'write_file', args: { path: 'a', contents: 'b' } }, {
      definitions: DEFAULT_TOOL_DEFINITIONS.filter(tool => tool.name === 'read_file'),
      confirmApproval: async () => true, authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
    })).toMatchObject({ allowed: false });
  });

  it('returns lead hook context to the requesting child without adding a fake lead observation', async () => {
    const onAdditionalContext = vi.fn();
    const result = await authorizeTeammateTool({ tool: 'read_file', args: { path: 'a.txt' } }, {
      definitions: DEFAULT_TOOL_DEFINITIONS, confirmApproval: async () => true,
      authorization: {
        permissionManager: new PermissionManager({ mode: 'unrestricted' }), onAdditionalContext,
        runPreToolHooks: async () => [{ hook: { event: 'pre-tool', command: 'policy' }, success: true, duration: 0,
          response: { additionalContext: 'Do not expose customer data in the summary.' } }],
      },
    });
    expect(result).toMatchObject({ allowed: true, additionalContext: ['Do not expose customer data in the summary.'] });
    expect(onAdditionalContext).not.toHaveBeenCalled();
  });

  it('fails closed when authorization times out, is malformed, or cannot be sent', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const broker = new TeammateAuthorizationBroker(send, 100);
      const context = { tool: 'write_file', toolCallId: 'write', args: { path: 'a.txt', contents: 'x' } };
      const execution = { taskId: 'task', runId: 'attempt' };
      const timedOut = broker.authorize(context, execution);
      const rejection = expect(timedOut).rejects.toThrow('Timed out');
      await Promise.all([rejection, vi.advanceTimersByTimeAsync(100)]);
      expect(send).toHaveBeenCalledWith('team.authorizationCancel', expect.anything());
      const malformed = broker.authorize(context, execution);
      broker.handleResult({ requestId: send.mock.calls.at(-1)![1].requestId, result: { allowed: true } });
      await expect(malformed).rejects.toThrow('invalid');
      send.mockImplementation(() => { throw new Error('Pipe closed'); });
      await expect(broker.authorize(context, execution)).rejects.toThrow('Pipe closed');
      broker.disconnect();
    } finally { vi.useRealTimers(); }
  });

  it('fails unresolved interactive asks closed without opening a modal and honors specific lead rules', async () => {
    const confirm = vi.fn(async () => true);
    const permissionManager = new PermissionManager();
    const call = { tool: 'write_file' as const, args: { path: 'reviewed.txt', contents: 'x' } };
    const options = { definitions: DEFAULT_TOOL_DEFINITIONS, authorization: { permissionManager },
      confirmApproval: createTeammateConfirmation({ options: {}, config: {} }, confirm) };
    const denied = await authorizeTeammateTool(call, options);
    expect(denied).toMatchObject({ allowed: false, error: expect.stringContaining('Authorize a specific rule in the lead') });
    expect(confirm).not.toHaveBeenCalled();
    expect(await authorizeTeammateTool(call, { ...options, authorization: {
      permissionManager: new PermissionManager({ allowPatterns: [{ kind: 'write_file', argument: 'reviewed.txt' }] }),
    } })).toMatchObject({ allowed: true });
  });

  it('preserves explicit lead auto-approval without bypassing the authorization pipeline', async () => {
    const confirm = vi.fn(async () => true);
    const guarded = createTeammateConfirmation({ options: { yes: true }, config: {} }, confirm);
    expect(await guarded('Write file?', { tool: 'write_file' })).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
