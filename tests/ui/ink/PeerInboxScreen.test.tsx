import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from 'ink-testing-library';
import { PeerInboxScreen } from '../../../src/ui/ink/components/PeerInboxScreen.js';
import { launchInk } from '../../../src/testing/drivers/ink-driver.js';
import type { PeerMessage } from '../../../src/session/peers/PeerProtocol.js';

afterEach(cleanup);
const message: PeerMessage = { version: 1, messageId: 'question', from: 'peer-sender', senderInstanceId: 'sender-instance', senderAlias: 'sender', senderProject: 'Project', to: 'peer-reader', recipientInstanceId: 'reader-instance', content: 'Let the current build finish; no kill needed.', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sequence: 1 };

describe('keyboard peer inbox', () => {
  it('expands a message and returns an exact correlated reply draft', async () => {
    const onClose = vi.fn();
    const ui = launchInk(<PeerInboxScreen messages={[message]} onClose={onClose} />);
    await ui.settle();
    expect(ui.snapshot()).toContain('Peer inbox');
    expect(ui.snapshot()).toContain('Let the current build finish');
    await ui.enter();
    expect(ui.snapshot()).toContain('no kill needed.');
    await ui.type('r');
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'question', reference: expect.objectContaining({ peerId: 'peer-sender', instanceId: 'sender-instance' }) }));
  });

  it('sanitizes peer text and keeps Escape and Ctrl+C as local close actions', async () => {
    const onClose = vi.fn();
    const ui = launchInk(<PeerInboxScreen messages={[{ ...message, content: '\x1b]52;c;clipboard\x07Safe text' }]} onClose={onClose} />);
    await ui.settle();
    expect(ui.snapshot()).toContain('Safe text');
    expect(ui.snapshot()).not.toContain('52;c;clipboard');
    await ui.escape();
    expect(onClose).toHaveBeenCalledWith();
    await ui.ctrlC();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
