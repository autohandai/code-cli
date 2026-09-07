import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'fs-extra';
import type { Session } from 'tuistory';
import { declineStartupPlan, leaveStartupPlanMode, startPlanFromComposer } from '../../src/testing/scenarios/planStartupScenario.js';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive,
  launchBuiltAutohand, waitForExit, type MockNativeToolServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await server.close();
  for (const state of states.splice(0)) await state.cleanup();
});

async function launch(args: string[], reviewPlan = false) {
  const server = await createMockAutohandAINativeSequenceServer([
    ...(reviewPlan ? [
      { content: 'Creating a plan.', toolCall: { id: 'create-plan', name: 'plan', args: { notes: '1. Read the existing module\n2. Refactor the module\n3. Run tests' } } },
      { content: 'The plan tool saved three concrete steps. I will now present the saved plan for the user to review.', toolCall: { id: 'review-plan', name: 'exit_plan_mode', args: {} } },
    ] : []),
    { content: reviewPlan ? 'The plan is pending approval. Attempting a write should still be blocked by the plan-mode tool gate.' : 'Attempting a write.', toolCall: { id: 'startup-write', name: 'write_file', args: { path: 'blocked.txt', contents: 'blocked' } } },
    { content: 'PLAN_STARTUP_COMPLETE' },
  ]);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-test-key', model: 'moa', baseUrl: server.baseUrl },
    features: { autohand_inference: true },
    agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
    network: { maxRetries: 0, retryDelay: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
  } });
  states.push(state);
  const session = await launchBuiltAutohand([
    ...args, '--config', state.configPath, '--path', state.workspaceRoot,
  ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
  sessions.push(session);
  return { session, state, server };
}

function toolResult(server: MockNativeToolServer, requestIndex: number, toolCallId: string): string | undefined {
  const messages = server.requests[requestIndex]?.messages as Array<{ role: string; tool_call_id?: string; content?: string }> | undefined;
  return messages?.find((message) => message.role === 'tool' && message.tool_call_id === toolCallId)?.content;
}

async function expectReadOnlyFirstTurn(state: TuistoryTempState, server: MockNativeToolServer) {
  expect(await fs.pathExists(path.join(state.workspaceRoot, 'blocked.txt'))).toBe(false);
  expect(server.requests.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(server.requests[0]?.messages)).toContain('Plan Mode');
  const tools = server.requests[0]?.tools as Array<{ function: { name: string } }>;
  expect(tools.map((tool) => tool.function.name)).toContain('read_file');
  expect(tools.map((tool) => tool.function.name)).not.toContain('write_file');
  expect(toolResult(server, 1, 'startup-write')).toContain('not available in plan mode');
}

describe('plan mode startup Tuistory', () => {
  it('starts the first composer in plan mode, blocks writes, and keeps mode switching available', async () => {
    const { session, state, server } = await launch(['--plan']);
    const modeLine = await startPlanFromComposer(session);
    await expect(`${modeLine}\n`).toMatchFileSnapshot(path.resolve(
      import.meta.dirname, '../../src/testing/snapshots/plan-startup-composer.txt',
    ));
    await expectReadOnlyFirstTurn(state, server);
    await leaveStartupPlanMode(session);
    await exitInteractive(session);
  });

  it('gates the first command request even with --yes', async () => {
    const { session, state, server } = await launch(['--plan', '--yes', '--prompt', 'Plan a small refactor']);
    await waitForExit(session, 30_000);
    expect(await session.readAll()).toContain('PLAN_STARTUP_COMPLETE');
    expect(session.exitInfo?.exitCode).toBe(0);
    await expectReadOnlyFirstTurn(state, server);
  });

  it('leaves a one-shot plan pending review and blocks writes after exit_plan_mode', async () => {
    const { session, state, server } = await launch(['--plan', '--yes', '--prompt', 'Plan a small refactor'], true);
    await waitForExit(session, 30_000);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(await fs.pathExists(path.join(state.workspaceRoot, 'blocked.txt'))).toBe(false);
    expect(toolResult(server, 2, 'review-plan')).toContain('Plan ready for review');
    expect(toolResult(server, 3, 'startup-write')).toContain('not available in plan mode');
  });

  it('requires an interactive acceptance decision even with --yes and keeps a declined plan read-only', async () => {
    const { session, state, server } = await launch(['--plan', '--yes'], true);
    await declineStartupPlan(session);
    expect(await fs.pathExists(path.join(state.workspaceRoot, 'blocked.txt'))).toBe(false);
    expect(toolResult(server, 2, 'review-plan')).toContain('Plan not accepted');
    expect(toolResult(server, 3, 'startup-write')).toContain('not available in plan mode');
    await exitInteractive(session);
  });

  it.each(['--auto-mode', '--yolo', '--auto-commit'])('rejects conflicting execution flag %s before contacting the provider', async (flag) => {
    const { session, server } = await launch(['--plan', flag]);
    await waitForExit(session);
    expect(await session.readAll()).toContain('cannot be used with');
    expect(session.exitInfo?.exitCode).toBe(1);
    expect(server.requests).toHaveLength(0);
  });

  it('lists --plan in root command help', async () => {
    const { session } = await launch(['--help']);
    await waitForExit(session);
    expect(await session.readAll()).toContain('--plan');
    expect(session.exitInfo?.exitCode).toBe(0);
  });
});
