/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import stringWidth from 'string-width';
import { isAgentRunActive, type AgentRun, type AgentRunSource, type AgentRunsSnapshot } from '../../core/agents/AgentRunStore.js';
import { sanitizeAnnouncementText } from '../../announcements/AnnouncementContent.js';
import { useTheme } from '../theme/ThemeContext.js';
import { InputLine } from './InputLine.js';
import { TextBuffer } from '../textBuffer.js';
import { handleTextBufferKey } from '../textBufferKeyHandler.js';

export interface AgentRunsPanelProps {
  snapshot: AgentRunsSnapshot;
  terminalRows?: number;
  terminalColumns?: number;
  source?: AgentRunSource;
  onClose: () => void;
  onCancel?: (id: string) => void | Promise<unknown>;
  onMessage?: (id: string, text: string) => Promise<boolean>;
  onCtrlC: () => void;
}

interface AgentRunMessageInputProps {
  width: number;
  rows: number;
  disabled: boolean;
  onSubmit: (text: string) => void;
}

function AgentRunMessageInput({ width, rows, disabled, onSubmit }: AgentRunMessageInputProps) {
  const [buffer] = useState(() => new TextBuffer(Math.max(1, width - 4), rows));
  const [view, setView] = useState({ value: '', offset: 0 });
  const refresh = useCallback(() => {
    const lines = buffer.getRenderedLines();
    const [visualRow] = buffer.getVisualCursor();
    const visualStart = buffer.getVisualLayout().visualToLogical[visualRow]?.[1] ?? 0;
    const cursor = Array.from(buffer.getLines()[buffer.getCursorRow()] ?? '')
      .slice(0, buffer.getCursorCol()).join('').length;
    const preceding = lines.slice(0, visualRow - buffer.getScrollRow());
    setView({ value: lines.join('\n'), offset: preceding.reduce((total, line) => total + line.length + 1, 0) + cursor - visualStart });
  }, [buffer]);
  useEffect(() => { buffer.setViewport(Math.max(1, width - 4), rows); refresh(); }, [buffer, refresh, rows, width]);
  usePaste((text) => {
    if (disabled) return;
    buffer.insert(text);
    refresh();
  });
  useInput((input, key) => {
    if (disabled || key.escape || (key.ctrl && !key.leftArrow && !key.rightArrow && input !== 'a' && input !== 'e')) return;
    const name = key.return ? 'return' : key.backspace ? 'backspace' : key.delete ? 'delete'
      : key.leftArrow ? 'left' : key.rightArrow ? 'right' : key.upArrow ? 'up' : key.downArrow ? 'down'
        : key.home ? 'home' : key.end ? 'end' : key.ctrl ? input : undefined;
    const result = handleTextBufferKey(buffer, input, { name, ctrl: key.ctrl, meta: key.meta, shift: key.shift });
    if (result === 'submit') onSubmit(buffer.getText());
    else if (result === 'handled') refresh();
  });
  return <InputLine value={view.value} cursorOffset={view.offset} isActive width={width}
    placeholderText="Message this worker" enableMouseCursor={false} enableHardwareCursor={!disabled} />;
}

function messageUnavailableReason(run: AgentRun | undefined): string | undefined {
  if (!run) return 'Run is no longer available to message.';
  if (run.source === 'squad') return 'External Squad runs cannot receive messages here.';
  if (!isAgentRunActive(run)) return 'This run has finished and cannot receive messages.';
  if (run.cancelRequested) return 'This run is stopping and cannot receive messages.';
  if (!run.messageable) return 'This run cannot receive messages.';
  return undefined;
}

function cancelUnavailableReason(run: AgentRun | undefined): string | undefined {
  if (!run) return 'Run is no longer available to cancel.';
  if (run.source === 'squad') return 'External Squad runs cannot be stopped here.';
  if (!isAgentRunActive(run)) return 'This run has already finished.';
  if (run.cancelRequested) return 'Cancellation is already requested.';
  if (!run.cancellable) return 'This run cannot be stopped here.';
  return undefined;
}

function clean(text: string): string {
  return sanitizeAnnouncementText(text, { maxCharacters: 8192, preserveParagraphs: true });
}

function duration(run: AgentRun, now: number): string {
  const until = run.source !== 'squad' && isAgentRunActive(run) ? now : run.finishedAt ?? run.updatedAt;
  return `${Math.max(0, Math.round((until - run.startedAt) / 1000))}s`;
}

function activityLabel(run: AgentRun): string {
  if (!isAgentRunActive(run)) return run.status;
  if (run.cancelRequested) return 'Cancellation requested';
  const activity = sanitizeAnnouncementText(run.activity ?? '', { maxCharacters: 256, preserveParagraphs: false });
  if (activity === 'Thinking') return 'Waiting for model';
  return activity.split(', ').map((tool) => {
    switch (tool) {
      case 'read_file': return 'Reading files';
      case 'run_command': return 'Running command';
      case 'fff_grep': return 'Searching contents';
      case 'fff_find': return 'Finding files';
      default: return tool || 'Starting';
    }
  }).join('; ');
}

function indentation(run: AgentRun, runs: AgentRun[]): string {
  let depth = run.depth ?? 0;
  if (run.depth === undefined) {
    let parent = runs.find((candidate) => candidate.id === run.parentId);
    const seen = new Set([run.id]);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      depth += 1;
      parent = runs.find((candidate) => candidate.id === parent?.parentId);
    }
  }
  return '  '.repeat(Math.max(0, Math.min(3, depth)));
}

function wrapDetailLine(text: string, columns: number): string[] {
  const lines: string[] = [];
  let line = '';
  let width = 0;
  for (const character of clean(text)) {
    const nextWidth = stringWidth(character);
    if (line && width + nextWidth > columns) {
      lines.push(line);
      line = '';
      width = 0;
    }
    line += character;
    width += nextWidth;
  }
  lines.push(line);
  return lines;
}

export function AgentRunsPanel({ snapshot, terminalRows = 24, terminalColumns = 80, source, onClose, onCancel, onMessage, onCtrlC }: AgentRunsPanelProps) {
  const { colors } = useTheme();
  const runs = useMemo(() => snapshot.runs.filter((run) => !source || run.source === source), [snapshot.runs, source]);
  const [selectedId, setSelectedId] = useState<string | undefined>(runs[0]?.id);
  const [mode, setMode] = useState<'list' | 'details' | 'confirm' | 'message'>('list');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('error');
  const [messageTargetId, setMessageTargetId] = useState<string>();
  const [sendingMessage, setSendingMessage] = useState(false);
  const sendingMessageRef = useRef(false);
  const messageRequestRef = useRef(0);
  const [cancellationTargetId, setCancellationTargetId] = useState<string>();
  const [detailOffset, setDetailOffset] = useState(0);
  const [now, setNow] = useState(Date.now);
  const selectedIndex = Math.max(0, runs.findIndex((run) => run.id === selectedId));
  const selected = runs[selectedIndex];
  const rows = Math.max(3, Math.floor(terminalRows) - 7);
  const listRows = Math.max(1, Math.floor(rows / 2));
  const listStart = Math.max(0, selectedIndex - listRows + 1);
  const visibleRuns = runs.slice(listStart, listStart + listRows);
  const sessionActive = snapshot.runs.filter((run) => run.source !== 'squad' && isAgentRunActive(run)).length;
  const external = snapshot.runs.filter((run) => run.source === 'squad').length;
  const hasRunningSession = sessionActive > 0;
  const messageTarget = runs.find((run) => run.id === messageTargetId);
  const canMessage = Boolean(onMessage && !messageUnavailableReason(selected));
  const canCancel = Boolean(onCancel && !cancelUnavailableReason(selected));

  const submitMessage = (text: string) => {
    if (sendingMessageRef.current || !text.trim()) return;
    const unavailable = messageUnavailableReason(messageTarget);
    if (unavailable || !onMessage || !messageTarget) {
      setNoticeKind('error');
      setNotice(unavailable ?? 'Messaging is unavailable.');
      return;
    }
    sendingMessageRef.current = true;
    const request = ++messageRequestRef.current;
    setSendingMessage(true);
    setNotice('');
    void Promise.resolve().then(() => onMessage(messageTarget.id, text.trim())).then((queued) => {
      if (messageRequestRef.current !== request) return;
      setNoticeKind(queued ? 'success' : 'error');
      setNotice(queued ? 'Message queued for next model request.' : 'Message was not queued. Try again or check this run.');
      if (queued) setMode('list');
    }).catch((error: unknown) => {
      if (messageRequestRef.current !== request) return;
      setNoticeKind('error');
      setNotice(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (messageRequestRef.current !== request) return;
      sendingMessageRef.current = false;
      setSendingMessage(false);
    });
  };

  useEffect(() => () => { messageRequestRef.current += 1; }, []);

  useEffect(() => {
    if (!hasRunningSession) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [hasRunningSession]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onCtrlC(); return; }
    if (key.escape) {
      if (mode === 'message') {
        messageRequestRef.current += 1;
        sendingMessageRef.current = false;
        setSendingMessage(false);
      }
      if (mode !== 'list') setMode('list');
      else onClose();
      return;
    }
    if (mode === 'message') return;
    if (input.toLowerCase() === 'm' && mode !== 'confirm') {
      const unavailable = messageUnavailableReason(selected);
      setNoticeKind('error');
      setNotice(unavailable ?? (!onMessage ? 'Messaging is unavailable.' : ''));
      if (!unavailable && onMessage && selected) {
        messageRequestRef.current += 1;
        setMessageTargetId(selected.id);
        setMode('message');
      }
      return;
    }
    if (mode === 'confirm') {
      if (input.toLowerCase() === 'y' && onCancel) {
        setMode('details');
        const target = runs.find((run) => run.id === cancellationTargetId);
        if (!target || cancelUnavailableReason(target)) {
          setNotice('Run is no longer available to cancel.');
          return;
        }
        void Promise.resolve().then(() => onCancel(target.id)).catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : String(error));
        });
      } else if (input.toLowerCase() === 'n') setMode('details');
      return;
    }
    if (input.toLowerCase() === 'c') {
      setNoticeKind('error');
      const unavailable = cancelUnavailableReason(selected);
      if (unavailable || !onCancel || !selected) {
        setNotice(unavailable ?? 'Cancellation is unavailable.');
        return;
      }
      setCancellationTargetId(selected.id);
      setNotice('');
      setMode('confirm');
      return;
    }
    if (key.return && selected) { setMode('details'); setDetailOffset(0); return; }
    if (mode === 'details' && (key.upArrow || key.downArrow)) {
      setDetailOffset((offset) => Math.max(0, Math.min(detailLines.length - rows, offset + (key.upArrow ? -1 : 1))));
      return;
    }
    if (mode === 'list' && (key.upArrow || key.downArrow)) {
      const next = Math.max(0, Math.min(runs.length - 1, selectedIndex + (key.upArrow ? -1 : 1)));
      setSelectedId(runs[next]?.id);
    }
  });

  const detailLines = selected ? [
    `Workspace: ${selected.workspaceRoot ?? 'unavailable'}`,
    ...(selected.userRequest ? [`User request: ${selected.userRequest}`] : []),
    `Task: ${selected.task}`,
    selected.source === 'squad' ? 'Scope: Squad external (independent budget)' : `Parent: ${selected.parentId ?? 'session lead'} · ${selected.source}`,
    `${selected.provider ?? 'Provider unavailable'} · ${selected.model ?? 'model unavailable'}`,
    `${selected.usage ? `${selected.usage.totalTokens} tokens (${selected.usage.promptTokens} input / ${selected.usage.completionTokens} output)` : 'Usage unavailable'} · ${duration(selected, now)}`,
    ...(selected.activity ? [`Activity: ${selected.activity}`] : []),
    ...(selected.error ? [`Error: ${selected.error}`] : []),
    ...(selected.output ? [`Output: ${selected.output}`] : []),
    ...(selected.cancelRequested && isAgentRunActive(selected) ? ['Cancellation requested; waiting for agent to stop.'] : []),
  ].flatMap((line) => line.split('\n').flatMap((part) => wrapDetailLine(part, Math.max(1, terminalColumns)))) : [];
  const visibleDetailOffset = Math.min(detailOffset, Math.max(0, detailLines.length - rows));

  return (
    <Box flexDirection="column" width={terminalColumns}>
      <Text bold wrap="truncate">{source === 'squad' ? 'Squad runs · external' : 'Session agents'} · {sessionActive} active{external > 0 ? ` · ${external} external` : ''}</Text>
      {snapshot.externalStatus && (external > 0 || source === 'squad')
        ? <Text color={colors.muted} wrap="truncate">{clean(snapshot.externalStatus)}</Text> : null}
      {mode === 'list' ? <>
        <Text color={colors.muted} wrap="truncate">↑/↓ select · Enter details{canMessage ? ' · m message' : ''}{canCancel ? ' · c cancel' : ''} · Esc back</Text>
        {visibleRuns.map((run) => <Box key={run.id} flexDirection="column">
          <Text wrap="truncate" color={run.id === selected?.id ? colors.accent : undefined}>
            {run.id === selected?.id ? '›' : ' '} {indentation(run, runs)}{clean(run.name)} · {run.status} · {run.source === 'squad' ? 'Squad external' : run.source} · {duration(run, now)}
          </Text>
          <Text wrap="truncate" color={colors.muted}>  {indentation(run, runs)}{activityLabel(run)}</Text>
        </Box>)}
        {runs.length === 0 ? <Text color={colors.muted}>No agent runs recorded yet.</Text> : <Text color={colors.muted} wrap="truncate">{selectedIndex + 1}/{runs.length} · {clean(selected?.task ?? '')}</Text>}
        {selected ? <Text color={colors.muted} wrap="truncate">Workspace: {clean(selected.workspaceRoot ?? 'unavailable')}</Text> : null}
      </> : mode === 'message' ? <>
        <Text bold wrap="truncate">Message {clean(messageTarget?.name ?? 'unavailable agent')}</Text>
        <Text color={colors.muted} wrap="truncate">Queued messages are read at the next model request.</Text>
        <AgentRunMessageInput width={terminalColumns} rows={Math.max(1, Math.min(4, terminalRows - 9))}
          disabled={sendingMessage} onSubmit={submitMessage} />
        <Text color={colors.muted} wrap="truncate">{sendingMessage ? 'Queueing message… · Esc close' : 'Enter queue · Esc discard'}</Text>
      </> : <>
        <Text bold wrap="truncate">{clean(selected?.name ?? 'Run unavailable')} · {selected?.status}</Text>
        {detailLines.slice(visibleDetailOffset, visibleDetailOffset + rows).map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
        {detailLines.length > rows ? <Text color={colors.muted}>↑/↓ scroll · {visibleDetailOffset + 1}–{Math.min(visibleDetailOffset + rows, detailLines.length)}/{detailLines.length}</Text> : null}
        {mode === 'confirm'
          ? <Text color={colors.warning} wrap="truncate">Cancel {clean(runs.find((run) => run.id === cancellationTargetId)?.name ?? 'unavailable agent')}? y confirm · n keep running</Text>
          : <Text color={colors.muted}>Esc list{canMessage ? ' · m message' : ''}{canCancel ? ' · c cancel' : ''}</Text>}
      </>}
      {notice ? <Text color={noticeKind === 'success' ? colors.success : colors.error} wrap="truncate">{clean(notice)}</Text> : null}
    </Box>
  );
}
