import React, { useEffect, useRef, useState } from 'react';
import { stripVTControlCharacters } from 'node:util';
import { Box, Static, Text, useInput, useStdout } from 'ink';
import { InputLine } from '../ui/ink/InputLine.js';
import { useTheme } from '../ui/theme/ThemeContext.js';
import type { CloudInteraction } from './CloudClient.js';
import type { CloudSessionState } from './CloudSession.js';
import { Modal, type ModalOption } from '../ui/ink/components/Modal.js';

export const cloudReviewTitle = 'Review the full cloud operation above in terminal scrollback';
export const cloudReviewOptions: ModalOption[] = [{ value: 'decline', label: 'Keep this operation pending' }, { value: 'approve', label: 'Approve the reviewed operation' }];

interface CloudReviewScreenProps {
  interaction: CloudInteraction;
  onDecision(approved: boolean): void;
}
export function CloudReviewScreen({ interaction, onDecision }: CloudReviewScreenProps) {
  return <>
    <Static items={[interaction]}>{item => <Text key={item.id}>{cloudDisplayText(cloudInteractionText(item))}{'\n'}</Text>}</Static>
    <Modal title={cloudReviewTitle} options={cloudReviewOptions} onSelect={option => onDecision(option.value === 'approve')} onCancel={() => onDecision(false)} />
  </>;
}

export function cloudDisplayText(value: string): string { return stripVTControlCharacters(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ''); }
export function cloudInteractionText(interaction: CloudInteraction): string {
  const payload = interaction.payload;
  if (payload.kind === 'question') return payload.questions.map(question => `${question.title}\n${question.options.join(' · ')}`).join('\n\n');
  if (payload.kind === 'approval') return `${payload.repository}\n${JSON.stringify(payload.action, null, 2)}`;
  if (payload.kind === 'connector_approval') return `${payload.connectorName} · ${payload.tool}\n${JSON.stringify(payload.arguments, null, 2)}`;
  return `Save skill ${payload.skill.name}\n${payload.skill.description}\n${payload.skill.instructions}`;
}
interface CloudScreenProps {
  state: CloudSessionState;
  onSubmit(text: string): Promise<boolean>;
  onSelect(direction: number): void;
  onDetach(): void;
}
export function CloudScreen({ state, onSubmit, onSelect, onDetach }: CloudScreenProps) {
  const { theme } = useTheme(), { stdout } = useStdout();
  const [draft, setDraft] = useState(''), [cursor, setCursor] = useState(0);
  const submitting = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'd' && !draft)) { onDetach(); return; }
    if (state.busy || submitting.current) return;
    if (key.upArrow || key.downArrow) { onSelect(key.upArrow ? -1 : 1); return; }
    const previous = Array.from(draft.slice(0, cursor)).at(-1)?.length ?? 1;
    const next = Array.from(draft.slice(cursor))[0]?.length ?? 1;
    if (key.leftArrow) { setCursor(Math.max(0, cursor - previous)); return; }
    if (key.rightArrow) { setCursor(Math.min(draft.length, cursor + next)); return; }
    if (key.ctrl && input === 'a') { setCursor(0); return; }
    if (key.ctrl && input === 'e') { setCursor(draft.length); return; }
    if (key.backspace || key.delete) {
      if (cursor > 0) { setDraft(draft.slice(0, cursor - previous) + draft.slice(cursor)); setCursor(cursor - previous); }
      return;
    }
    if (key.return) {
      if (!draft.trim()) return;
      submitting.current = true;
      void onSubmit(draft).then(accepted => { if (accepted && mounted.current) { setDraft(''); setCursor(0); } }).finally(() => { submitting.current = false; });
      return;
    }
    if (!key.ctrl && !key.meta && !key.escape && !key.tab) {
      const text = cloudDisplayText(input).replace(/\r?\n/g, ' ');
      if (draft.length + text.length <= 32_000) { setDraft(draft.slice(0, cursor) + text + draft.slice(cursor)); setCursor(cursor + text.length); }
    }
  });
  const queued = state.jobs.filter(job => job.state === 'queued');
  const queueStart = Math.max(0, Math.floor(state.selected / 10) * 10);
  const active = state.jobs.find(job => ['scheduled', 'running', 'waiting'].includes(job.state));
  return <Box flexDirection="column" paddingX={1}>
    <Box gap={2}><Text bold color={theme.getColor('accent')}>Autohand Cloud</Text><Text>{cloudDisplayText(state.conversation.model)}</Text><Text dimColor>{state.connected ? active?.state ?? 'connected' : 'reconnecting'}</Text></Box>
    <Text bold>{cloudDisplayText(state.conversation.title)}</Text>
    <Text dimColor>Session {state.conversation.id}</Text>
    <Box flexDirection="column" marginY={1}>
      {state.messages.slice(-3).map(message => <Box key={message.id} flexDirection="column" marginBottom={1}>
        <Text color={message.role === 'user' ? theme.getColor('dim') : theme.getColor('accent')}>{message.role === 'user' ? 'You' : 'Autohand'}{message.status === 'streaming' ? ' · working' : ''}</Text>
        <Text>{cloudDisplayText(message.content).slice(-1200)}</Text>
      </Box>)}
      {!state.messages.length ? <Text dimColor>Your hosted agent is ready. Enter a task to start.</Text> : null}
    </Box>
    {queued.length ? <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Queued · ↑/↓ selects · /steer sends the selected correction</Text>
      {queued.slice(queueStart, queueStart + 10).map((job, offset) => {
        const index = queueStart + offset;
        return <Text key={job.id} color={index === state.selected ? theme.getColor('accent') : undefined}>{index === state.selected ? '›' : ' '} {index + 1}. {cloudDisplayText(job.content).replace(/\s+/g, ' ').slice(0, 160)}</Text>;
      })}
    </Box> : null}
    {state.interaction?.state === 'pending' ? <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.getColor('warning')}>Cloud agent needs your review</Text>
      <Text>{cloudDisplayText(cloudInteractionText(state.interaction)).slice(0, 3000)}</Text>
      <Text dimColor>{state.interaction.payload.kind === 'question' ? '/answer responds to these questions' : '/approve opens the full review · /decline rejects this operation'}</Text>
    </Box> : null}
    <Text color={state.connected ? theme.getColor('dim') : theme.getColor('warning')}>{cloudDisplayText(state.notice)}</Text>
    <InputLine value={draft} cursorOffset={cursor} isActive={!state.busy} width={Math.max(20, (stdout.columns ?? 100) - 2)} placeholderText="Queue a task or type /help" enableMouseCursor={false} />
    <Text dimColor>Ctrl+C detaches · cloud work continues · /stop cancels · /open web shows the full transcript</Text>
  </Box>;
}
