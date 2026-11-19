/** @license Apache-2.0 */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { outputViewport } from '../../src/testing/scenarios/compactOutputScenario.js';
import {
  memoryEntryFiles,
  openMemoriesResetConfirmation,
  openMemoriesScreen,
  runSlashCommand,
  runTurnAndWaitForReply,
  seedMemories,
  setUseMemories,
  viewportAfterRedraw,
} from '../../src/testing/scenarios/memoriesScenario.js';
import { createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand, type MockNativeToolServer, type TuistoryTempState } from './helpers/autohandTuistory.js';

let state: TuistoryTempState | undefined;
let session: Session | undefined;
let server: MockNativeToolServer | undefined;

afterEach(async () => {
  session?.close();
  await server?.close();
  server = undefined;
  await state?.cleanup();
  session = undefined;
  state = undefined;
});

async function launch(options: { fullScreen?: boolean; config?: Record<string, unknown> } = {}): Promise<TuistoryTempState> {
  state = await createTempAutohandHome({ config: {
    features: { fullScreenMode: options.fullScreen ?? true },
    ui: { promptSuggestions: false },
    ...options.config,
  } });
  return state;
}

async function start(cols = 120, online = false): Promise<Session> {
  session = await launchBuiltAutohand(['--config', state!.configPath, ...(online ? [] : ['--offline'])], {
    autohandHome: state!.autohandHome, cwd: state!.workspaceRoot, waitForDataTimeout: 15_000, cols, rows: 40,
  });
  await session.waitForText('❯');
  return session;
}

const userMemoryDir = () => path.join(state!.autohandHome, 'memory');
const projectMemoryDir = () => path.join(state!.workspaceRoot, '.autohand', 'memory');
const savedConfig = async () => JSON.parse(await readFile(state!.configPath, 'utf8')) as { agent?: { autoMemory?: boolean; useMemories?: boolean } };

describe('/memory in the terminal', () => {
  it('shows the empty state in the full-screen transcript and keeps it after a redraw', async () => {
    await launch();
    const terminal = await start();
    expect(terminal.getRawOutput()).toContain('\x1b[?1049h');

    await runSlashCommand(terminal, '/memory');
    await terminal.waitForText('Memory Management');
    const viewport = await viewportAfterRedraw(terminal, 'memory stays visible');

    expect(viewport).toContain('Memory Management');
    expect(viewport).toContain('No memories stored.');
    expect(viewport).toContain('Tip: Type # followed by text to store a memory.');
    await exitInteractive(terminal);
  });

  it('lists stored memories, confirms a deletion and shows usage, all in the full-screen transcript', async () => {
    await launch();
    await seedMemories(userMemoryDir(), [{ id: 'aaaa1111', content: 'Prefers concise answers' }]);
    await seedMemories(projectMemoryDir(), [{ id: 'bbbb2222', content: 'Use strict TypeScript' }]);
    const terminal = await start();

    await runSlashCommand(terminal, '/memory');
    await terminal.waitForText('Total: 1 project, 1 user memories');
    let viewport = await viewportAfterRedraw(terminal, 'x');
    expect(viewport).toContain('Project Memory (.autohand/memory/)');
    expect(viewport).toContain('Use strict TypeScript');
    expect(viewport).toContain('ID: bbbb2222');
    expect(viewport).toContain('User Memory (~/.autohand/memory/)');
    expect(viewport).toContain('Prefers concise answers');
    await terminal.press('backspace');

    await runSlashCommand(terminal, '/memory delete user aaaa1111');
    await terminal.waitForText('Deleted user memory aaaa1111. The canonical deletion event was retained.');
    expect(await memoryEntryFiles(userMemoryDir())).toEqual([]);

    await runSlashCommand(terminal, '/memory zoom project');
    await terminal.waitForText('/memory zoom <user|project> <snapshot> <node>');
    viewport = outputViewport(terminal);
    expect(viewport).toContain('Deleted user memory aaaa1111.');
    await exitInteractive(terminal);
  });

  it('still shows the list in the classic layout', async () => {
    await launch({ fullScreen: false });
    await seedMemories(userMemoryDir(), [{ id: 'aaaa1111', content: 'Prefers concise answers' }]);
    const terminal = await start();
    expect(terminal.getRawOutput()).not.toContain('\x1b[?1049h');

    await runSlashCommand(terminal, '/memory');
    await terminal.waitForText('Total: 0 project, 1 user memories');

    expect(outputViewport(terminal)).toContain('Prefers concise answers');
    await exitInteractive(terminal);
  });

  it('confirms a # memory in the full-screen transcript after the level picker closes', async () => {
    await launch();
    const terminal = await start();

    await runSlashCommand(terminal, '# Always run the linter before committing');
    await terminal.waitForText('Where should this memory be stored?');
    await terminal.press('enter');
    await terminal.waitForText('Memory saved to project level.');
    const viewport = await viewportAfterRedraw(terminal, 'saved stays visible');

    expect(viewport).toContain('Memory saved to project level.');
    expect(await memoryEntryFiles(projectMemoryDir())).toHaveLength(1);
    await exitInteractive(terminal);
  });
});

describe('/memories in the terminal', () => {
  it('toggles memory generation, saves it on enter and shows the saved value when reopened', async () => {
    await launch();
    const terminal = await start();

    await openMemoriesScreen(terminal);
    let screen = outputViewport(terminal);
    expect(screen).toContain('Memories');
    expect(screen).toContain('› [x] Use memories');
    expect(screen).toContain('[x] Generate memories');
    expect(screen).toContain('Reset all memories');
    expect(screen).toContain('User memories stay on this machine (sync is off).');
    await terminal.press('down');
    await terminal.waitForText('› [x] Generate memories');
    await terminal.press('space');
    await terminal.waitForText('› [ ] Generate memories');
    await terminal.press('enter');
    await terminal.waitForText('Generate memories is now off.');
    expect((await savedConfig()).agent).toMatchObject({ autoMemory: false, useMemories: true });
    expect(await viewportAfterRedraw(terminal, 'x')).toContain('Generate memories is now off. Saved to');
    await terminal.press('backspace');

    await openMemoriesScreen(terminal);
    screen = outputViewport(terminal);
    expect(screen).toContain('  [ ] Generate memories');
    await terminal.press('space');
    await terminal.waitForText('› [ ] Use memories');
    await terminal.press('esc');
    await terminal.waitForText('❯');
    await terminal.type('cancel kept it off');
    await terminal.waitForText('❯ cancel kept it off');
    expect((await savedConfig()).agent).toMatchObject({ autoMemory: false, useMemories: true });
    await exitInteractive(terminal);
  });

  it('stops sending stored memories to the model once Use memories is off, and sends them again once it is on', async () => {
    const fact = 'Quokka-7741: the user wants answers in British English.';
    const lesson = 'Wombat-9903: this repository runs tests with Vitest.';
    server = await createMockAutohandAINativeSequenceServer([
      { content: 'REPLY_WITH_MEMORIES' }, { content: 'REPLY_WITHOUT_MEMORIES' }, { content: 'REPLY_WITH_MEMORIES_AGAIN' },
    ]);
    await launch({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture', model: 'moa', baseUrl: server.baseUrl },
      features: { fullScreenMode: true, autohand_inference: true },
      agent: { autoMemory: false, maxIterations: 3, sessionRetryLimit: 0 },
      network: { maxRetries: 0 },
      ui: { promptSuggestions: false, terminalBell: false, showCompletionNotification: false },
    } });
    await seedMemories(userMemoryDir(), [{ id: 'aaaa1111', content: fact }]);
    await seedMemories(projectMemoryDir(), [{ id: 'bbbb2222', content: lesson }]);
    const terminal = await start(120, true);
    const requestsFor = (marker: string) => server!.requests.map(request => JSON.stringify(request)).filter(body => body.includes(marker));

    await runTurnAndWaitForReply(terminal, 'TURN_ALPHA say hello', 'REPLY_WITH_MEMORIES');
    const withMemories = requestsFor('TURN_ALPHA');
    expect(withMemories.length).toBeGreaterThan(0);
    expect(withMemories.every(body => body.includes('Quokka-7741') && body.includes('Wombat-9903'))).toBe(true);
    expect(withMemories.every(body => body.includes('recall_memory'))).toBe(true);

    await setUseMemories(terminal, false);
    expect((await savedConfig()).agent).toMatchObject({ useMemories: false, autoMemory: false });
    await runTurnAndWaitForReply(terminal, 'TURN_BRAVO say hello again', 'REPLY_WITHOUT_MEMORIES');
    const withoutMemories = requestsFor('TURN_BRAVO');
    expect(withoutMemories.length).toBeGreaterThan(0);
    for (const body of withoutMemories) {
      expect(body).not.toContain('Quokka-7741');
      expect(body).not.toContain('Wombat-9903');
      expect(body).not.toContain('recall_memory');
      expect(body).not.toContain('inspect_memory');
      expect(body).toContain('TURN_ALPHA');
    }

    await setUseMemories(terminal, true);
    await runTurnAndWaitForReply(terminal, 'TURN_CHARLIE and once more', 'REPLY_WITH_MEMORIES_AGAIN');
    const again = requestsFor('TURN_CHARLIE');
    expect(again.length).toBeGreaterThan(0);
    expect(again.every(body => body.includes('Quokka-7741') && body.includes('Wombat-9903'))).toBe(true);
    await exitInteractive(terminal);
  });

  it('deletes local memories only after the confirmation, and leaves sessions alone', async () => {
    await launch();
    await seedMemories(userMemoryDir(), [{ id: 'aaaa1111', content: 'Prefers concise answers' }]);
    await seedMemories(projectMemoryDir(), [
      { id: 'bbbb2222', content: 'Use strict TypeScript' },
      { id: 'cccc3333', content: 'Run the linter before committing' },
    ]);
    const sessionMarker = path.join(state!.autohandHome, 'sessions', 'keep-me', 'conversation.jsonl');
    await mkdir(path.dirname(sessionMarker), { recursive: true });
    await writeFile(sessionMarker, '{"role":"user","content":"keep"}\n');
    const terminal = await start();

    await openMemoriesScreen(terminal);
    await openMemoriesResetConfirmation(terminal);
    const confirmation = outputViewport(terminal);
    expect(confirmation).toContain('This permanently deletes from this machine:');
    expect(confirmation).toContain('Project memories: 2 saved, with their history and summaries');
    expect(confirmation).toContain('User memories: 1 saved, with their history and summaries');
    expect(confirmation.replace(/\s+/gu, '')).toContain(projectMemoryDir().replace(/\s+/gu, ''));
    expect(confirmation).toContain('Conversation sessions and existing threads.');
    expect(confirmation).toContain('› Keep memories');

    await terminal.press('enter');
    await terminal.waitForText('enter save/select');
    expect(await memoryEntryFiles(projectMemoryDir())).toHaveLength(2);
    expect(await memoryEntryFiles(userMemoryDir())).toHaveLength(1);

    await terminal.press('enter');
    await terminal.waitForText('Reset all memories?');
    await terminal.press('down');
    await terminal.waitForText('› Delete local memories');
    await terminal.press('enter');
    await terminal.waitForText('User memories: deleted 1 from');

    const viewport = await viewportAfterRedraw(terminal, 'reset stays visible');
    expect(viewport).toContain('Project memories: deleted 2 from');
    expect(await memoryEntryFiles(projectMemoryDir())).toEqual([]);
    expect(await memoryEntryFiles(userMemoryDir())).toEqual([]);
    expect(await readFile(sessionMarker, 'utf8')).toContain('keep');
    expect(await readdir(path.join(state!.autohandHome, 'sessions'))).toContain('keep-me');
    await exitInteractive(terminal);
  });

  it('keeps a synced user library out of the reset', async () => {
    await launch({ config: { sync: { enabled: true } } });
    await seedMemories(userMemoryDir(), [{ id: 'aaaa1111', content: 'Prefers concise answers' }]);
    await seedMemories(projectMemoryDir(), [{ id: 'bbbb2222', content: 'Use strict TypeScript' }]);
    const terminal = await start();

    await openMemoriesScreen(terminal);
    expect(outputViewport(terminal)).toContain('User memories sync with your Autohand account.');
    await openMemoriesResetConfirmation(terminal);
    const confirmation = outputViewport(terminal);
    const [deleted, kept] = confirmation.split('Not changed:');
    expect(deleted).toContain('Project memories: 1 saved');
    expect(deleted).not.toContain('User memories');
    expect(kept.replace(/\s+/gu, ' ')).toContain('they sync with your Autohand account');
    await terminal.press('down');
    await terminal.press('enter');
    await terminal.waitForText('Project memories: deleted 1 from');

    expect(await memoryEntryFiles(projectMemoryDir())).toEqual([]);
    expect(await memoryEntryFiles(userMemoryDir())).toEqual(['aaaa1111.json']);
    await exitInteractive(terminal);
  });

  it('lays the options out under their labels in a narrow terminal and in the classic layout', async () => {
    await launch({ fullScreen: false });
    const terminal = await start(60);

    await openMemoriesScreen(terminal);
    const lines = outputViewport(terminal).split('\n');
    const use = lines.findIndex(line => line.includes('Use memories'));
    expect(lines[use].trimEnd()).toMatch(/› \[x\] Use memories$/u);
    expect(lines[use + 1]).toContain('Give stored memories');
    const generate = lines.findIndex(line => line.includes('Generate memories'));
    expect(lines[generate].trimEnd()).toMatch(/\[x\] Generate memories$/u);
    expect(lines[generate + 1]).toContain('Save durable memories');
    await terminal.press('esc');
    await terminal.waitForText('❯');
    await exitInteractive(terminal);
  });
});
