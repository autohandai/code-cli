import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Session } from 'tuistory';
import { seedTransferScenario, transferScenarioId } from '../../src/testing/scenarios/transferScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [], states: TuistoryTempState[] = [];
afterEach(async () => { for (const session of sessions.splice(0)) session.close(); for (const state of states.splice(0)) await state.cleanup(); });
async function launch(args: string[]) {
  const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } }); states.push(state);
  const preload = await seedTransferScenario(state.autohandHome);
  const session = await launchBuiltAutohand(['transfer', transferScenarioId, '--account', 'personal_fixture', '--config', state.configPath, '--offline', ...args], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { NODE_OPTIONS: `--import=${preload}` },
  }); sessions.push(session); return { state, session };
}
describe('standalone transfer terminal flow', () => {
  it('documents import and review options in the built CLI', async () => {
    const { session } = await launch(['--help']); await waitForExit(session);
    expect(await session.readAll()).toContain('--import-only'); expect(await session.readAll()).toContain('--accept'); expect(session.exitInfo?.exitCode).toBe(0);
  });
  it('cancels the review without writing a transferred session', async () => {
    const { state, session } = await launch([]); await session.waitForText('Continue in this terminal');
    await session.press('down'); await session.press('enter'); await waitForExit(session);
    await expect(fs.stat(path.join(state.autohandHome, 'sessions', `web-${transferScenarioId}`))).rejects.toThrow();
    expect(session.exitInfo?.exitCode).toBe(0);
  });
  it('imports without inference and then resumes the saved Web conversation in the built interactive CLI', async () => {
    const { state, session } = await launch(['--accept']);
    await session.waitForText(`Resumed session web-${transferScenarioId}`, { timeout: 30000 }); await session.waitForText('❯');
    await exitInteractive(session);
    const directory = path.join(state.autohandHome, 'sessions', `web-${transferScenarioId}`);
    const messages = (await fs.readFile(path.join(directory, 'conversation.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(messages.map(message => message.content)).toEqual(['Keep the parser history', 'The parser context is saved.']);
    expect(JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8')).model).toBe('moa');
  });
});
