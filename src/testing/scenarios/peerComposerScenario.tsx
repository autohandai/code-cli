import React, { useEffect } from 'react';
import { render } from 'ink';
import { createPeerHarness } from './peerCommunicationHarness.js';
import { AgentUI, createInitialUIState } from '../../ui/ink/AgentUI.js';
import { ThemeProvider } from '../../ui/theme/ThemeContext.js';
import { I18nProvider } from '../../ui/i18n/index.js';
import { readInstruction, promptSuspend, getActiveTextBuffer, type PromptDraft } from '../../ui/inputPrompt.js';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { PeerScope } from '../../session/peers/PeerProtocol.js';
import { TypedMessageHistory } from '../../session/TypedMessageHistory.js';

const harness = await createPeerHarness();
const sender = await harness.create({ alias: 'sender', policy: { enabled: true, scope: 'machine' } });
await harness.create({ alias: 'builder' });
await harness.create({ alias: 'reviewer' });
const outside = path.join(harness.root, 'outside');
await mkdir(outside);
await harness.create({ alias: 'remote', workspaceRoot: outside, policy: { enabled: true, scope: 'machine' } });
await sender.list();
let replaced = false;
const peers = (scope?: PeerScope) => sender.cachedPeers(scope).map(peer => replaced && peer.alias === 'builder' ? { ...peer, peerId: 'replacement-builder', instanceId: 'replacement' } : peer).sort((left, right) => left.alias.localeCompare(right.alias));
function ComposerReady() {
  useEffect(() => { process.stderr.write('PEER_COMPOSER_READY\n'); }, []);
  return null;
}
if (process.argv.includes('--fallback')) {
  let draft: PromptDraft | undefined;
  let suspended = false;
  const suspension = process.argv.includes('--suspend-draft') ? setInterval(() => {
    if (!suspended && getActiveTextBuffer()?.getText().includes('Preserve this draft')) { suspended = true; promptSuspend(); }
  }, 10) : undefined;
  try {
    const read = () => readInstruction(() => [], [], undefined, {
      typedMessageHistory: new TypedMessageHistory(), initialDraft: draft, onSuspend: value => { draft = value; },
    }, undefined, harness.workspaceRoot, draft?.text ?? '', undefined, undefined, undefined, undefined, {
      scopes: ['workspace', 'repository', 'machine'],
      peersProvider: peers,
      refresh: scope => sender.list({ scope }),
      send: async input => { const receipt = await sender.send(input); replaced = process.argv.includes('--history-churn'); return receipt; },
    });
    let result = await read();
    if (result === null && suspended) {
      replaced = true;
      process.stdout.write('PEER_DRAFT_SUSPENDED\n');
      result = await read();
    }
    if (result && result !== 'ABORT') throw new Error('Direct messages must bypass the model');
  } finally { if (suspension) clearInterval(suspension); await harness.close(); }
} else {
const instance = render(<I18nProvider><ThemeProvider><AgentUI
  state={{ ...createInitialUIState(), isWorking: true }}
  peerScopes={['workspace', 'repository', 'machine']}
  peersProvider={peers}
  onPeersRefresh={scope => sender.list({ scope })}
  onInstruction={() => { throw new Error('Direct messages must bypass the model'); }}
  onPeerMessage={input => sender.send(input)}
  onEscape={() => {}}
  onCtrlC={() => instance.unmount()}
/><ComposerReady /></ThemeProvider></I18nProvider>, { exitOnCtrlC: false });
try { await instance.waitUntilExit(); } finally { await harness.close(); }
}
