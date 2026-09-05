/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import { isAgentRunActive, type AgentRun, type AgentRunSource, type AgentRunsSnapshot } from '../../core/agents/AgentRunStore.js';
import { sanitizeAnnouncementText } from '../../announcements/AnnouncementContent.js';
import { useTheme } from '../theme/ThemeContext.js';

export interface AgentRunsPanelProps {
  snapshot: AgentRunsSnapshot;
  terminalRows?: number;
  terminalColumns?: number;
  source?: AgentRunSource;
  onClose: () => void;
  onCancel?: (id: string) => void | Promise<unknown>;
  onCtrlC: () => void;
}

function clean(text: string): string {
  return sanitizeAnnouncementText(text, { maxCharacters: 8192, preserveParagraphs: true });
}

function duration(run: AgentRun, now: number): string {
  const until = run.source !== 'squad' && isAgentRunActive(run) ? now : run.finishedAt ?? run.updatedAt;
  return `${Math.max(0, Math.round((until - run.startedAt) / 1000))}s`;
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

export function AgentRunsPanel({ snapshot, terminalRows = 24, terminalColumns = 80, source, onClose, onCancel, onCtrlC }: AgentRunsPanelProps) {
  const { colors } = useTheme();
  const runs = useMemo(() => snapshot.runs.filter((run) => !source || run.source === source), [snapshot.runs, source]);
  const [selectedId, setSelectedId] = useState<string | undefined>(runs[0]?.id);
  const [mode, setMode] = useState<'list' | 'details' | 'confirm'>('list');
  const [notice, setNotice] = useState('');
  const [cancellationTargetId, setCancellationTargetId] = useState<string>();
  const [detailOffset, setDetailOffset] = useState(0);
  const [now, setNow] = useState(Date.now);
  const selectedIndex = Math.max(0, runs.findIndex((run) => run.id === selectedId));
  const selected = runs[selectedIndex];
  const rows = Math.max(3, Math.floor(terminalRows) - 7);
  const listStart = Math.max(0, selectedIndex - rows + 1);
  const visibleRuns = runs.slice(listStart, listStart + rows);
  const sessionActive = snapshot.runs.filter((run) => run.source !== 'squad' && isAgentRunActive(run)).length;
  const external = snapshot.runs.filter((run) => run.source === 'squad').length;
  const hasRunningSession = sessionActive > 0;

  useEffect(() => {
    if (!hasRunningSession) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [hasRunningSession]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onCtrlC(); return; }
    if (key.escape) {
      if (mode !== 'list') setMode('list');
      else onClose();
      return;
    }
    if (mode === 'confirm') {
      if (input.toLowerCase() === 'y' && onCancel) {
        setMode('details');
        const target = runs.find((run) => run.id === cancellationTargetId);
        if (!target || !target.cancellable || !isAgentRunActive(target) || target.cancelRequested) {
          setNotice('Run is no longer available to cancel.');
          return;
        }
        void Promise.resolve().then(() => onCancel(target.id)).catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : String(error));
        });
      } else if (input.toLowerCase() === 'n') setMode('details');
      return;
    }
    if (input.toLowerCase() === 'c' && selected?.cancellable && !selected.cancelRequested && isAgentRunActive(selected) && onCancel) {
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
      {snapshot.externalStatus ? <Text color={colors.muted} wrap="truncate">{clean(snapshot.externalStatus)}</Text> : null}
      {mode === 'list' ? <>
        <Text color={colors.muted} wrap="truncate">↑/↓ select · Enter details · c cancel · Esc back</Text>
        {visibleRuns.map((run) => <Text key={run.id} wrap="truncate" color={run.id === selected?.id ? colors.accent : undefined}>
          {run.id === selected?.id ? '›' : ' '} {indentation(run, runs)}{clean(run.name)} · {run.status} · {run.source === 'squad' ? 'Squad external' : run.source} · {duration(run, now)}
        </Text>)}
        {runs.length === 0 ? <Text color={colors.muted}>No agent runs recorded yet.</Text> : <Text color={colors.muted} wrap="truncate">{selectedIndex + 1}/{runs.length} · {clean(selected?.task ?? '')}</Text>}
      </> : <>
        <Text bold wrap="truncate">{clean(selected?.name ?? 'Run unavailable')} · {selected?.status}</Text>
        {detailLines.slice(visibleDetailOffset, visibleDetailOffset + rows).map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
        {detailLines.length > rows ? <Text color={colors.muted}>↑/↓ scroll · {visibleDetailOffset + 1}–{Math.min(visibleDetailOffset + rows, detailLines.length)}/{detailLines.length}</Text> : null}
        {mode === 'confirm'
          ? <Text color={colors.warning} wrap="truncate">Cancel {clean(runs.find((run) => run.id === cancellationTargetId)?.name ?? 'unavailable agent')}? y confirm · n keep running</Text>
          : <Text color={colors.muted}>Esc list{selected?.cancellable ? ' · c cancel' : ''}</Text>}
      </>}
      {notice ? <Text color={colors.error} wrap="truncate">{clean(notice)}</Text> : null}
    </Box>
  );
}
