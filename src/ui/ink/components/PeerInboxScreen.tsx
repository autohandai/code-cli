import React, { useEffect, useState } from 'react';
import { Box, Text, render, useInput, useStdout } from 'ink';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import type { PeerClient, PeerMessage } from '../../../session/peers/PeerMessaging.js';
import type { PeerComposerDraft } from '../../peerMention.js';
import { safePeerLabel } from '../../../session/peers/PeerScope.js';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext.js';
import { I18nProvider } from '../../i18n/index.js';
import { prepareModalRender, cleanupModalRender } from './Modal.js';

export interface PeerInboxScreenProps { messages: PeerMessage[]; onClose: (draft?: PeerComposerDraft) => void; messaging?: PeerClient; }

function messageLines(content: string, width: number): string[] {
  const clean = stripVTControlCharacters(content).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ' ');
  const lines: string[] = [];
  for (const paragraph of clean.split('\n')) {
    let line = '';
    let length = 0;
    for (const character of paragraph) {
      const size = stringWidth(character);
      if (length + size > width) { lines.push(line); line = ''; length = 0; }
      line += character;
      length += size;
    }
    lines.push(line);
  }
  return lines;
}

export function PeerInboxScreen({ messages: initialMessages, onClose, messaging }: PeerInboxScreenProps) {
  const { colors } = useTheme();
  const { stdout } = useStdout();
  const [messages, setMessages] = useState(initialMessages);
  const [selection, setSelection] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const height = Math.max(3, (stdout.rows ?? 24) - 6);
  const width = Math.max(16, (stdout.columns ?? 80) - 4);
  const selected = messages[Math.min(selection, Math.max(0, messages.length - 1))];
  const lines = selected ? messageLines(selected.content, width) : [];
  useEffect(() => {
    if (!messaging) return;
    let mounted = true;
    const unsubscribe = messaging.subscribe(event => {
      if (event.type === 'message') void messaging.messages({ consume: false }).then(result => { if (mounted) setMessages(result.messages); }).catch(() => {});
    });
    return () => { mounted = false; unsubscribe(); };
  }, [messaging]);
  useInput((input, key) => {
    if (key.escape || input === 'q' || key.ctrl && input === 'c') { onClose(); return; }
    if (key.return) { setExpanded(value => !value); setOffset(0); return; }
    if (input === 'r' && selected) {
      const alias = selected.senderAlias ?? 'peer';
      onClose({ reference: { peerId: selected.from, instanceId: selected.senderInstanceId, ...(selected.senderRunId ? { runId: selected.senderRunId } : {}), alias, start: 0, end: alias.length + 1 }, replyTo: selected.messageId });
      return;
    }
    if (key.upArrow || key.downArrow) {
      const step = key.upArrow ? -1 : 1;
      if (expanded) setOffset(value => Math.max(0, Math.min(Math.max(0, lines.length - height), value + step)));
      else setSelection(value => Math.max(0, Math.min(messages.length - 1, value + step)));
    }
  });
  const first = Math.max(0, selection - height + 1);
  return <Box flexDirection="column">
    <Text bold color={colors.accent}>Peer inbox · {messages.length} unread</Text>
    <Text color={colors.muted}>Preview keeps messages unread until recorded context or an explicit inbox read.</Text>
    {expanded && selected ? <>
      <Text bold>From :{safePeerLabel(selected.senderAlias ?? selected.from)} · {safePeerLabel(selected.senderProject ?? '')}</Text>
      {lines.slice(offset, offset + height).map((line, index) => <Text key={index}>{line || ' '}</Text>)}
    </> : messages.slice(first, first + Math.max(1, Math.floor(height / 2))).map((message, index) => <Box key={`${message.from}:${message.messageId}`} flexDirection="column">
      <Text color={first + index === selection ? colors.accent : colors.text}>{first + index === selection ? '▸' : ' '} :{safePeerLabel(message.senderAlias ?? message.from)} · {safePeerLabel(message.senderProject ?? '')}</Text>
      <Text wrap="truncate">  {safePeerLabel(message.content, width)}</Text>
    </Box>)}
    {!messages.length && <Text>No unread peer messages.</Text>}
    <Text color={colors.muted}>Enter expand/collapse · r reply · ↑↓ navigate · Esc close</Text>
  </Box>;
}

export async function showPeerInboxScreen(messaging: PeerClient): Promise<PeerComposerDraft | undefined> {
  const { messages } = await messaging.messages({ consume: false });
  prepareModalRender(process.stdout);
  let draft: PeerComposerDraft | undefined;
  try {
    const instance = render(<I18nProvider><ThemeProvider><PeerInboxScreen messages={messages} messaging={messaging} onClose={value => { draft = value; instance.unmount(); }} /></ThemeProvider></I18nProvider>, { exitOnCtrlC: false });
    await instance.waitUntilExit();
  } finally { cleanupModalRender(process.stdout); }
  return draft;
}
