import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup } from 'ink-testing-library';
import { launchInk } from '../../../src/testing/drivers/ink-driver.js';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import type { PeerDescriptor } from '../../../src/session/peers/PeerProtocol.js';
import { TypedMessageHistory } from '../../../src/session/TypedMessageHistory.js';

afterEach(cleanup);

const peers: PeerDescriptor[] = [
  { peerId: 'peer-builder-a', instanceId: 'a', sessionId: 'session-a', alias: 'builder', project: 'Build Project', kind: 'root', activity: 'running_command', availability: 'available', capabilities: ['message.receive'] },
  { peerId: 'peer-reviewer-b', instanceId: 'b', sessionId: 'session-b', runId: 'review-1', alias: 'reviewer', project: 'Review Project', kind: 'run', activity: 'thinking', availability: 'available', capabilities: ['message.receive'] },
];

function composer(props: Partial<React.ComponentProps<typeof AgentUI>> = {}) {
  const onInstruction = vi.fn();
  const onPeerMessage = vi.fn(async () => ({ messageId: 'message-1', to: peers[0].peerId, state: 'accepted' as const, cursor: '1', acceptedAt: new Date().toISOString() }));
  const onCtrlC = vi.fn();
  return {
    onInstruction, onPeerMessage, onCtrlC,
    ...launchInk(<AgentUI state={createInitialUIState()} onInstruction={onInstruction} onPeerMessage={onPeerMessage} onEscape={() => {}} onCtrlC={onCtrlC} peersProvider={() => peers} {...props} />),
  };
}

describe('colon recipient picker in the actual Ink composer', () => {
  it('revalidates a queued edit against its selected incarnation', async () => {
    const onReplaceQueuedInstruction = vi.fn();
    const text = 'Tell :builder the patch is ready';
    const ui = composer({
      peersProvider: () => [{ ...peers[0], peerId: 'replacement', instanceId: 'replacement' }],
      state: { ...createInitialUIState(), isWorking: true, queuedInstructions: [text], queuedInstructionMetadata: [{ peerReferences: [{ alias: 'builder', start: 5, end: 13, peerId: peers[0].peerId, instanceId: peers[0].instanceId }] }] },
      onReplaceQueuedInstruction,
    });
    await ui.settle();
    await ui.down();
    await ui.enter();
    await ui.type(' now');
    await ui.enter();
    expect(onReplaceQueuedInstruction).not.toHaveBeenCalled();
    expect(ui.snapshot()).toMatch(/offline|incarnation|reselect/i);
    expect(ui.snapshot()).toContain(`${text} now`);
  });

  it('replaces queued metadata when the user deliberately selects another peer', async () => {
    const onReplaceQueuedInstruction = vi.fn();
    const ui = composer({ state: { ...createInitialUIState(), isWorking: true, queuedInstructions: ['Original instruction'] }, onReplaceQueuedInstruction });
    await ui.settle();
    await ui.down();
    await ui.enter();
    await ui.ctrlC();
    await ui.type('Tell :rev');
    await ui.tab();
    await ui.type('review this');
    await ui.enter();
    expect(onReplaceQueuedInstruction).toHaveBeenCalledWith(0, 'Tell :reviewer review this', expect.objectContaining({ peerReferences: [expect.objectContaining({ peerId: peers[1].peerId, runId: peers[1].runId })] }));
    expect(ui.onInstruction).not.toHaveBeenCalled();
  });

  it('preserves a selected draft across an Ink unmount and remount', async () => {
    const onInputChange = vi.fn();
    const ui = composer({ onInputChange });
    await ui.settle();
    await ui.type(':bu');
    await ui.tab();
    await ui.type('Keep the selected recipient');
    const [currentInput, peerInputMetadata] = onInputChange.mock.lastCall!;
    expect(peerInputMetadata).toMatchObject({ peerReferences: [expect.objectContaining({ peerId: peers[0].peerId })] });
    cleanup();
    const resumed = composer({
      state: { ...createInitialUIState(), currentInput, peerInputMetadata },
      peersProvider: () => [{ ...peers[0], peerId: 'replacement', instanceId: 'replacement' }],
    });
    await resumed.settle();
    await resumed.enter();
    expect(resumed.onPeerMessage).not.toHaveBeenCalled();
    expect(resumed.snapshot()).toMatch(/offline|incarnation|reselect/i);
  });

  it('preserves the selected incarnation when an instruction is recalled from history', async () => {
    const history = new TypedMessageHistory();
    let cached = peers;
    const ui = composer({ typedMessageHistory: history, peersProvider: () => cached });
    await ui.settle();
    await ui.type('Tell :bu');
    await ui.tab();
    await ui.type('the patch is ready');
    await ui.enter();
    expect(ui.onInstruction).toHaveBeenCalledOnce();
    cached = [{ ...peers[0], peerId: 'replacement-builder', instanceId: 'replacement-instance' }];
    await ui.up();
    await ui.enter();
    expect(ui.onInstruction).toHaveBeenCalledOnce();
    expect(ui.snapshot()).toMatch(/offline|incarnation|reselect/i);
    expect(ui.snapshot()).toContain('Tell :builder the patch is ready');
  });

  it('switches discovery scope explicitly without submitting or changing the draft', async () => {
    const onPeersRefresh = vi.fn(async () => {});
    const ui = composer({ peerScopes: ['workspace', 'repository', 'machine'], onPeersRefresh });
    await ui.settle();
    await ui.type('Ask :');
    expect(ui.snapshot()).toContain('workspace');
    await ui.type('\u001b[Z');
    expect(onPeersRefresh).toHaveBeenLastCalledWith('repository');
    expect(ui.snapshot()).toContain('repository');
    expect(ui.snapshot()).toContain('Ask :');
    expect(ui.onInstruction).not.toHaveBeenCalled();
  });

  it('dismisses an empty picker with Escape without cancelling the current turn', async () => {
    const onEscape = vi.fn();
    const ui = composer({ peersProvider: () => [], onEscape, state: { ...createInitialUIState(), isWorking: true } });
    await ui.settle();
    await ui.type('Tell :nobody');
    expect(ui.snapshot()).toContain('No matching peers');
    await ui.escape();
    expect(ui.snapshot()).toContain('Tell :nobody');
    expect(ui.snapshot()).not.toContain('No matching peers');
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('refreshes on opening and displays newly discovered peers without another keystroke', async () => {
    let cached: PeerDescriptor[] = [];
    const onPeersRefresh = vi.fn(async () => { cached = peers; });
    const ui = composer({ peersProvider: () => cached, onPeersRefresh });
    await ui.settle();
    await ui.type(':');
    await ui.settle();
    expect(onPeersRefresh).toHaveBeenCalledTimes(1);
    expect(ui.snapshot()).toContain(':builder');
    await ui.type('bu');
    expect(onPeersRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft when a retry returns a durable rejected receipt', async () => {
    const ui = composer({ onPeerMessage: async () => ({ messageId: 'rejected', to: peers[0].peerId, cursor: '1', state: 'rejected', outcome: 'QUEUE_FULL' }) });
    await ui.settle();
    await ui.type(':bu');
    await ui.tab();
    await ui.type('Keep rejected draft');
    await ui.enter();
    expect(ui.snapshot()).toContain('Keep rejected draft');
    expect(ui.snapshot()).toContain('QUEUE_FULL');
  });

  it('opens a cached peer directory with readable identity and capability information', async () => {
    const ui = composer();
    await ui.settle();
    await ui.type(':');
    const frame = ui.snapshot();
    expect(frame).toContain(':builder');
    expect(frame).toContain('Build Project');
    expect(frame).toContain(':reviewer');
    expect(frame).toContain('Tab');
    expect(frame).not.toContain('peer-builder-a');
    expect(frame).not.toContain('endpoint');
  });

  it('uses the first Enter to select, then sends without a model call', async () => {
    const ui = composer();
    await ui.settle();
    await ui.type(':bu');
    await ui.enter();
    expect(ui.onInstruction).not.toHaveBeenCalled();
    expect(ui.onPeerMessage).not.toHaveBeenCalled();
    await ui.type('Build the patch');
    await ui.enter();
    expect(ui.onPeerMessage).toHaveBeenCalledWith(expect.objectContaining({ to: peers[0].peerId, content: 'Build the patch' }));
    expect(ui.onInstruction).not.toHaveBeenCalled();
    expect(ui.snapshot()).toContain('accepted');
  });

  it('supports down/up selection and Tab while a local instruction is busy', async () => {
    const ui = composer({ state: { ...createInitialUIState(), isWorking: true } });
    await ui.settle();
    await ui.type(':');
    await ui.down();
    await ui.up();
    await ui.down();
    await ui.tab();
    await ui.type('Review this');
    await ui.enter();
    expect(ui.onPeerMessage).toHaveBeenCalledWith(expect.objectContaining({ to: peers[1].peerId, content: 'Review this' }));
    expect(ui.onInstruction).not.toHaveBeenCalled();
  });

  it('dismisses the picker with Escape without clearing the draft or cancelling the current turn', async () => {
    const onEscape = vi.fn();
    const ui = composer({ onEscape });
    await ui.settle();
    await ui.type('Tell :bu');
    await ui.escape();
    expect(ui.snapshot()).toContain('Tell :bu');
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('preserves a failed direct-send draft for correction or reselection', async () => {
    const onPeerMessage = vi.fn(async () => { throw Object.assign(new Error('Peer went offline; reselect the recipient.'), { code: 'PEER_OFFLINE' }); });
    const ui = composer({ onPeerMessage });
    await ui.settle();
    await ui.type(':bu');
    await ui.tab();
    await ui.type('Keep my draft');
    await ui.enter();
    expect(ui.snapshot()).toContain('Keep my draft');
    expect(ui.snapshot()).toMatch(/offline|reselect/i);
    expect(ui.onInstruction).not.toHaveBeenCalled();
  });

  it('passes inline selection as a structured reference to the local instruction', async () => {
    const ui = composer();
    await ui.settle();
    await ui.type('Tell :bu');
    await ui.tab();
    await ui.type('the change is ready');
    await ui.enter();
    expect(ui.onPeerMessage).not.toHaveBeenCalled();
    expect(ui.onInstruction).toHaveBeenCalledWith('Tell :builder the change is ready', expect.objectContaining({ peerReferences: [expect.objectContaining({ peerId: peers[0].peerId })] }));
  });

  it.each(['https://example.com:8080', '12:30', 'C:\\src', 'package:script', ':smile:', '`literal :builder`', '/help :builder', '!echo :builder'])('preserves existing input mode for %s', async text => {
    const ui = composer();
    await ui.settle();
    await ui.type(text);
    expect(ui.snapshot()).not.toContain('Build Project');
    expect(ui.onPeerMessage).not.toHaveBeenCalled();
  });

  it('never auto-sends a bracketed multiline paste', async () => {
    const ui = composer();
    await ui.settle();
    await ui.type('\x1b[200~:builder copied\nsecond line\x1b[201~');
    expect(ui.onPeerMessage).not.toHaveBeenCalled();
    expect(ui.onInstruction).not.toHaveBeenCalled();
    expect(ui.snapshot()).toContain('copied');
  });

  it('sanitizes peer-controlled terminal escapes in suggestions', async () => {
    const ui = composer({ peersProvider: () => [{ ...peers[0], project: '\x1b]52;c;secret\x07Visible\x1b[2J' }] });
    await ui.settle();
    await ui.type(':');
    expect(ui.snapshot()).not.toContain('52;c;secret');
    expect(ui.snapshot()).toContain('Visible');
  });

  it('retains the existing two-step Ctrl+C exit flow', async () => {
    const ui = composer();
    await ui.settle();
    await ui.ctrlC();
    expect(ui.onCtrlC).not.toHaveBeenCalled();
    await ui.ctrlC();
    expect(ui.onCtrlC).toHaveBeenCalledTimes(1);
  });
});
