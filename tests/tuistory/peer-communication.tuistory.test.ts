import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';
import { openPeerInbox, preserveDraftWhileClosingPeerPicker, selectPeerAndSend, waitForPeerComposer } from '../../src/testing/scenarios/peerCommunicationScenario.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    if (!session.exitInfo) await exitInteractive(session).catch(() => {});
    session.close();
  }
  for (const state of states.splice(0)) await state.cleanup();
});

async function pair() {
  const state = await createTempAutohandHome({ config: {
    ui: { promptSuggestions: false },
    sessions: { awareness: 'warn', communication: { enabled: true, scope: 'workspace', idleBehavior: 'notify', alias: 'sender' } },
  } });
  states.push(state);
  const secondConfig = path.join(state.autohandHome, 'second', 'config.json');
  await mkdir(path.dirname(secondConfig), { recursive: true });
  const config = JSON.parse(await readFile(state.configPath, 'utf8'));
  config.sessions.communication.alias = 'receiver';
  await writeFile(secondConfig, JSON.stringify(config));
  const sender = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
  sessions.push(sender);
  await waitForPeerComposer(sender);
  const receiver = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', secondConfig, '--yes'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
  sessions.push(receiver);
  await waitForPeerComposer(receiver);
  await vi.waitFor(async () => {
    const registry = path.join(state.autohandHome, 'active-agents');
    const entries = await readdir(registry);
    const records = await Promise.all(entries.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(registry, name), 'utf8'))));
    expect(records.filter(record => record.communication?.protocol === 1).map(record => record.communication.alias).sort()).toEqual(['receiver', 'sender']);
  }, { timeout: 5_000, interval: 100 });
  return { sender, receiver, state };
}

describe('built CLI peer communication', () => {
  it('selects a live peer, sends without a provider turn, opens the inbox and replies by keyboard', async () => {
    const { sender, receiver } = await pair();
    const sent = await selectPeerAndSend(sender, 'receiver', 'Let the current build finish; no kill needed.');
    expect(sent).toContain('accepted');
    expect(sent).not.toMatch(/401|Invalid API key|Payment required/);
    const arrived = await receiver.text({ timeout: 20_000, waitFor: text => text.includes('Message from :sender') });
    expect(arrived).toContain('Message from :sender');
    const inbox = await openPeerInbox(receiver);
    expect(inbox).toContain('Let the current build finish');
    await receiver.press('enter');
    await receiver.text({ timeout: 20_000, waitFor: text => text.includes('no kill needed.') });
    await receiver.type('r');
    await receiver.text({ timeout: 20_000, waitFor: text => text.includes(':sender') && text.includes('❯') });
    await receiver.type('Confirmed. I will finish this build.');
    await receiver.press('enter');
    await receiver.text({ timeout: 20_000, waitFor: text => text.includes('To :sender') && text.includes('accepted') });
    await sender.text({ timeout: 20_000, waitFor: text => text.includes('Message from :receiver') });
    await exitInteractive(receiver);
    sessions.splice(sessions.indexOf(receiver), 1);
    await exitInteractive(sender);
    sessions.splice(sessions.indexOf(sender), 1);
  });

  it('preserves composer text when dismissing the picker and when a selected peer exits', async () => {
    const { sender, receiver } = await pair();
    expect(await preserveDraftWhileClosingPeerPicker(sender)).toContain('Keep this draft :');
    await sender.press(['ctrl', 'c']);
    await sender.text({ timeout: 5_000, waitFor: text => !text.includes('❯ Keep this draft') });
    await sender.type(':receiver');
    await sender.text({ timeout: 20_000, waitFor: text => text.includes(':receiver') && text.includes('Tab') });
    await sender.press('tab');
    await sender.type('Keep this message');
    await exitInteractive(receiver);
    sessions.splice(sessions.indexOf(receiver), 1);
    await sender.press('enter');
    const failed = await sender.text({ timeout: 20_000, waitFor: text => /offline|reselect|PEER_OFFLINE/.test(text) });
    expect(failed).toContain('Keep this message');
    expect(failed).not.toContain('Message sent');
  });

  it('keeps communication disabled by default with a useful enable instruction', async () => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    states.push(state);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
    sessions.push(session);
    await waitForPeerComposer(session);
    await session.type('/peers send peer-example hello');
    await session.press('enter');
    const output = await session.text({ timeout: 20_000, waitFor: text => text.includes('sessions.communication.enabled') });
    expect(output).toContain('sessions.communication.enabled');
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  });
});
