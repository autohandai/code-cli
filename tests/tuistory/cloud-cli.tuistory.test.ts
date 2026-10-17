import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { seedCloudScenario, cloudScenarioId, cloudViewport } from '../../src/testing/scenarios/cloudScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [], states: TuistoryTempState[] = [];
afterEach(async () => { for (const session of sessions.splice(0)) session.close(); for (const state of states.splice(0)) await state.cleanup(); });
async function launch(args: string[], tier = 'pro', review = false, queueSize = 0, handoff = false) {
  const state = await createTempAutohandHome({ config: { api: { accountId: 'personal_fixture' } } }); states.push(state);
  const preload = await seedCloudScenario(state.autohandHome, tier, review, queueSize, handoff);
  const session = await launchBuiltAutohand(['--cloud', '--config', state.configPath, ...args], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { NODE_OPTIONS: `--import=${preload}` } });
  sessions.push(session); return { state, session };
}
async function requests(state: TuistoryTempState) { return (await readFile(path.join(state.autohandHome, 'cloud-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { route: string; method: string; account?: string; body?: { content?: string; requestId?: string; jobId?: string; revision?: number; executionMode?: string; target?: string; conversationId?: string } }); }
describe('built CLI cloud terminal flow', () => {
  it('defaults to staying in Cloud and allows cancelling local import before writing a session', async () => {
    const { state, session } = await launch(['--resume', cloudScenarioId, '--plan'], 'pro', false, 0, true);
    await session.waitForText('Cloud session connected');
    await session.type('/handoff'); await session.press('enter');
    await session.waitForText('Stay in Cloud'); await session.press('enter');
    await vi.waitFor(() => expect(cloudViewport(session)).toContain('Ctrl+C detaches'));
    expect((await requests(state)).some(call => call.route.startsWith('transfers/'))).toBe(false);
    await session.type('/handoff'); await session.press('enter');
    await session.waitForText('Stay in Cloud'); await session.press('down'); await session.press('enter');
    await session.waitForText('Continue in this terminal'); await session.press('down'); await session.press('enter');
    await waitForExit(session);
    await expect(readFile(path.join(state.autohandHome, 'sessions', `web-${cloudScenarioId}`, 'metadata.json'), 'utf8')).rejects.toThrow();
    expect(session.exitInfo?.exitCode).toBe(0);
  });
  it('restores the reviewed cloud history into a local composer with read-only plan mode intact', async () => {
    const { state, session } = await launch(['--resume', cloudScenarioId, '--plan'], 'pro', false, 0, true);
    const before = await readFile(state.configPath, 'utf8');
    await session.waitForText('Cloud session connected');
    await session.type('/handoff'); await session.press('enter');
    await session.waitForText('Stay in Cloud'); await session.press('down'); await session.press('enter');
    await session.waitForText('Continue in this terminal'); await session.press('enter');
    await session.waitForText(`Resumed session web-${cloudScenarioId}`, { timeout: 30_000 });
    await session.waitForText('● PLAN', { timeout: 10_000 });
    const calls = await requests(state);
    expect(calls.find(call => call.route === 'transfers/from-conversation')).toMatchObject({ account: 'personal_fixture', body: { conversationId: cloudScenarioId, target: 'cli' } });
    expect(calls.filter(call => call.route.endsWith('/messages'))).toEqual([]);
    const directory = path.join(state.autohandHome, 'sessions', `web-${cloudScenarioId}`);
    expect((await readFile(path.join(directory, 'conversation.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).content)).toEqual(['Keep the parser history', 'The parser context is saved.']);
    await exitInteractive(session);
    const saved = JSON.parse(await readFile(state.configPath, 'utf8')), original = JSON.parse(before);
    expect(saved.provider).toBe(original.provider);
    expect(saved.auth).toEqual(original.auth);
    expect(saved.api.accountId).toBe(original.api.accountId);
    expect(saved.autohandai).toBeUndefined();
  });
  it('keeps the selected message visible and steers it after the queue changes order', async () => {
    const { state, session } = await launch(['--resume', cloudScenarioId], 'pro', false, 12);
    await session.waitForText('Cloud session connected');
    for (let index = 0; index < 10; index++) await session.press('down');
    await session.waitForText('› 11. Correction 11');
    await writeFile(path.join(state.autohandHome, 'cloud-reorder-queue'), 'reverse');
    await session.type('/refresh'); await session.press('enter');
    await session.waitForText('› 2. Correction 11');
    await session.type('/steer'); await session.press('enter');
    await session.waitForText('Selected message sent as steering');
    await session.press(['ctrl', 'c']); await waitForExit(session);
    expect((await requests(state)).find(call => call.route.endsWith('/queue/steer'))?.body).toMatchObject({ jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000010', revision: 3 });
  });
  it('reviews the full pending operation, defaults to leaving it pending, and approves only the explicit selection', async () => {
    const { state, session } = await launch(['--prompt', 'Review the parser write', '--cloud-repository', 'autohand/parser', '--cloud-connector', 'github-app:fixture', '--cloud-branch', 'main'], 'pro', true);
    await session.waitForText('Cloud agent needs your review');
    expect(await session.readAll()).not.toContain('FULL_REVIEW_SENTINEL');
    expect((await requests(state)).some(call => call.route.includes('/interactions/'))).toBe(false);
    await session.type('/approve'); await session.press('enter');
    await vi.waitFor(() => expect(cloudViewport(session)).toContain('Review the full cloud operation'));
    expect(await session.readAll()).toContain('FULL_REVIEW_SENTINEL');
    await session.press('enter'); await vi.waitFor(() => expect(cloudViewport(session)).toContain('Ctrl+C detaches'));
    expect((await requests(state)).some(call => call.route.includes('/interactions/'))).toBe(false);
    await session.type('/approve'); await session.press('enter');
    await vi.waitFor(() => expect(cloudViewport(session)).toContain('Review the full cloud operation'));
    await session.press('down');
    await vi.waitFor(() => expect(cloudViewport(session)).toContain('▸ 2. Approve the reviewed operation'));
    await session.press('enter');
    await vi.waitFor(async () => expect((await requests(state)).filter(call => call.route.includes('/interactions/'))).toHaveLength(1));
    await vi.waitFor(() => expect(cloudViewport(session)).toContain('Ctrl+C detaches'));
    await session.press(['ctrl', 'c']); await waitForExit(session);
    const answers = (await requests(state)).filter(call => call.route.includes('/interactions/'));
    expect(answers).toHaveLength(1);
    expect(answers[0]?.body).toMatchObject({ kind: 'approval', decision: 'approve', revision: 4 });
  });
  it('attaches a workspace, queues input, steers the selected correction and detaches without cancelling', async () => {
    const { state, session } = await launch(['--prompt', 'Repair parser', '--cloud-repository', 'autohand/parser', '--cloud-connector', 'github-app:fixture', '--cloud-branch', 'main']);
    await session.waitForText('Cloud agent connected');
    await expect(await session.text({ immediate: true })).toMatchFileSnapshot('../../src/testing/snapshots/cloud-cli.txt');
    await session.type('Keep the public API'); await session.press('enter'); await session.waitForText('2. Keep the public API');
    await session.press('down'); await session.type('/steer'); await session.press('enter'); await session.waitForText('Selected message sent as steering');
    await session.press(['ctrl', 'c']); await waitForExit(session);
    const calls = await requests(state), sends = calls.filter(call => call.route.endsWith('/messages'));
    expect(sends.map(call => call.body?.executionMode)).toEqual(['auto', 'auto']);
    expect(calls.find(call => call.route.endsWith('/queue/steer'))?.body).toMatchObject({ jobId: sends[1].body?.requestId, revision: 3 });
    expect(calls.some(call => call.route.endsWith('/stop'))).toBe(false);
    expect(calls.findIndex(call => call.route === 'workspaces')).toBeLessThan(calls.findIndex(call => call.route.endsWith('/messages')));
    expect(session.exitInfo?.exitCode).toBe(0);
  });
  it('resumes a saved session without replaying a task, and stops only on /stop', async () => {
    const { state, session } = await launch(['--resume', cloudScenarioId]);
    await session.waitForText('Cloud session connected');
    expect(await session.text({ immediate: true })).toContain(cloudScenarioId);
    await session.type('/stop'); await session.press('enter'); await session.waitForText('Cloud stop requested');
    await session.press(['ctrl', 'c']); await waitForExit(session);
    const calls = await requests(state);
    expect(calls.filter(call => call.method === 'POST').map(call => call.route)).toEqual([`conversations/${cloudScenarioId}/stop`]);
  });
  it('refuses an unsupported plan before provisioning or sending a task', async () => {
    const { state, session } = await launch(['--prompt', 'Repair parser'], 'lite'); await waitForExit(session);
    expect(await session.readAll()).toContain('Pro, Pro+, and Max');
    expect((await requests(state)).every(call => call.method === 'GET')).toBe(true);
    expect(session.exitInfo?.exitCode).not.toBe(0);
  });
});
