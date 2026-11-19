/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useInput, useWindowSize } from 'ink';
import chalk from 'chalk';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext.js';
import { prepareModalRender, cleanupModalRender } from './Modal.js';
import { DISABLE_SGR_MOUSE_TRACKING, ENABLE_SGR_MOUSE_TRACKING, parseSgrMouseInput, type SgrMouseInput } from '../mouseInput.js';
import { formatAge } from '../../sessionPickerRows.js';
import {
  AGENT_SESSION_FILTERS, AGENT_SESSION_FILTER_LABELS, AGENT_SESSION_STATUS_LABELS, abbreviatePath, buildOverviewLines, countByFilter, openBlocker,
  type AgentSessionEntry, type AgentSessionFilter, type OverviewLine,
} from '../../../session/agentSessionOverview.js';

export type ResumeDirectoryPreference = 'ask' | 'session' | 'current';

export interface AgentSessionChoice {
  sessionId: string;
  projectPath: string;
  directory: 'session' | 'current';
  /** Set when the user chose an "Always" option: the preference to persist. */
  remember?: 'session' | 'current';
}

export interface AgentSessionsSnapshot {
  entries: AgentSessionEntry[];
  /** Saved sessions older than the ones loaded. */
  remaining: number;
}

export interface AgentSessionsScreenProps {
  load: (limit: number) => Promise<AgentSessionsSnapshot>;
  loadFirstPrompt: (sessionId: string) => Promise<string | undefined>;
  currentWorkspace: string;
  home: string;
  pid: number;
  directoryPreference: ResumeDirectoryPreference;
  onClose: (choice: AgentSessionChoice | null) => void;
  rows?: number;
  columns?: number;
  now?: () => Date;
  refreshMs?: number;
  pageSize?: number;
}

export interface ShowAgentSessionsScreenOptions extends Omit<AgentSessionsScreenProps, 'onClose'> {
  /** Report clicks and the wheel to the screen. Terminal mouse reporting replaces native text selection while it is open. */
  mouse?: boolean;
}

const TAB_ROW = 1;
const BODY_ROW = 4;
const CHROME_ROWS = BODY_ROW + 2;
const TAB_GAP = '   ';
const PANE_MIN_COLUMNS = 100;
const PANE_RULE = ' │ ';
const STATUS_WIDTH = 9;
const UPDATED_WIDTH = 8;
const WHEEL_ROWS = 3;
const MORE_KEY = '\u0000more';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_REFRESH_MS = 3_000;
/** Reverse video as its own SGR pair: Ink's `inverse` goes through chalk and vanishes when chalk detects no colour. */
const INVERSE_ON = '\u001b[7m';
const INVERSE_OFF = '\u001b[27m';

const DIRECTORY_OPTIONS = [
  { directory: 'session', remember: false, label: 'Use session directory' },
  { directory: 'current', remember: false, label: 'Use current directory' },
  { directory: 'session', remember: true, label: 'Always use session directory' },
  { directory: 'current', remember: true, label: 'Always use current directory' },
] as const;
const DIRECTORY_OPTIONS_ROW = BODY_ROW + 3;

function fit(value: string, width: number): string {
  if (width <= 0) return '';
  let text = '';
  let used = 0;
  const clipped = stringWidth(value) > width;
  for (const character of value) {
    const next = stringWidth(character);
    if (used + next > (clipped ? width - 1 : width)) break;
    text += character;
    used += next;
  }
  if (clipped) { text += '…'; used += 1; }
  return text + ' '.repeat(Math.max(0, width - used));
}

function wrap(value: string, width: number, maxLines: number): string[] {
  const lines = wrapAnsi(value, Math.max(1, width), { hard: true, trim: true }).split('\n');
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), fit(lines[maxLines - 1] ?? '', Math.max(1, width - 1)).trimEnd() + '…'];
}

function lineKey(line: OverviewLine | undefined): string | undefined {
  return line?.kind === 'session' ? line.entry.sessionId : line?.kind === 'more' ? MORE_KEY : undefined;
}

/** Column ranges of the filter tabs as drawn, so a click resolves only against what is on screen. */
export function filterTabSpans(counts: Record<AgentSessionFilter, number>, width: number): Array<{ filter: AgentSessionFilter; label: string; start: number; end: number }> {
  let start = 0;
  return AGENT_SESSION_FILTERS.flatMap((filter) => {
    const label = `${AGENT_SESSION_FILTER_LABELS[filter]} ${counts[filter]}`;
    const span = { filter, label, start, end: start + label.length };
    start = span.end + TAB_GAP.length;
    return span.end <= width ? [span] : [];
  });
}

export function AgentSessionsScreen(props: AgentSessionsScreenProps) {
  const { load, loadFirstPrompt, currentWorkspace, home, pid, directoryPreference, onClose } = props;
  const now = props.now ?? (() => new Date());
  const pageSize = props.pageSize ?? DEFAULT_PAGE_SIZE;
  const { colors } = useTheme();
  const size = useWindowSize();
  const width = Math.max(40, props.columns ?? size.columns ?? 80);
  const height = Math.max(CHROME_ROWS + 3, (props.rows ?? size.rows ?? 24) - 1);
  const bodyHeight = height - CHROME_ROWS;

  const [snapshot, setSnapshot] = useState<AgentSessionsSnapshot>();
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const [filter, setFilter] = useState<AgentSessionFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string>();
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<AgentSessionEntry>();
  const [directoryIndex, setDirectoryIndex] = useState(0);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const requestedPrompts = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      load(limit).then((next) => { if (!cancelled) { setSnapshot(next); setError(''); } })
        .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    };
    refresh();
    const timer = setInterval(refresh, props.refreshMs ?? DEFAULT_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [load, limit, props.refreshMs]);

  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot]);
  const counts = useMemo(() => countByFilter(entries), [entries]);
  const lines = useMemo(() => buildOverviewLines(entries, filter, snapshot?.remaining ?? 0), [entries, filter, snapshot]);
  const selectable = useMemo(() => lines.flatMap((line, index) => line.kind === 'group' ? [] : [index]), [lines]);
  const foundIndex = lines.findIndex((line) => lineKey(line) === selectedKey && selectedKey !== undefined);
  const preferred = lines.findIndex((line) => line.kind === 'session' && line.entry.current);
  const selectedIndex = foundIndex >= 0 ? foundIndex : preferred >= 0 ? preferred : selectable[0] ?? -1;
  const selectedLine = lines[selectedIndex];
  const selected = selectedLine?.kind === 'session' ? selectedLine.entry : undefined;
  // Follow the selection, bringing the group heading above a row into view with it.
  let visibleTop = Math.min(offset, Math.max(0, lines.length - bodyHeight));
  if (selectedIndex >= 0) {
    if (selectedIndex - 1 < visibleTop) visibleTop = Math.max(0, selectedIndex - 1);
    if (selectedIndex >= visibleTop + bodyHeight) visibleTop = selectedIndex - bodyHeight + 1;
  }

  const showPane = width >= PANE_MIN_COLUMNS;
  const listWidth = showPane ? Math.max(48, Math.floor(width * 0.56)) : width - 1;
  const paneWidth = showPane ? width - 1 - listWidth - PANE_RULE.length : 0;
  const tabs = filterTabSpans(counts, width - 1);

  const promptSessionId = selected?.saved ? selected.sessionId : undefined;
  useEffect(() => {
    if (!promptSessionId || requestedPrompts.current.has(promptSessionId)) return;
    requestedPrompts.current.add(promptSessionId);
    loadFirstPrompt(promptSessionId)
      .then((prompt) => setPrompts((known) => ({ ...known, [promptSessionId]: prompt ?? '' })))
      .catch(() => { requestedPrompts.current.delete(promptSessionId); });
  }, [loadFirstPrompt, promptSessionId]);

  // Several keys can arrive before the next render; the cursor ref keeps each one moving from the last.
  const cursor = useRef(selectedIndex);
  cursor.current = selectedIndex;
  const select = (index: number) => {
    const key = lineKey(lines[index]);
    if (key === undefined) return;
    cursor.current = index;
    setSelectedKey(key);
    setNotice('');
  };
  const move = (delta: number) => {
    if (selectable.length === 0) return;
    const position = Math.max(0, selectable.indexOf(cursor.current));
    select(selectable[Math.max(0, Math.min(selectable.length - 1, position + delta))]!);
  };
  const openFilter = (next: AgentSessionFilter) => { setFilter(next); setSelectedKey(undefined); setOffset(0); setNotice(''); };
  const finish = (entry: AgentSessionEntry, directory: 'session' | 'current', remember?: 'session' | 'current') =>
    onClose({ sessionId: entry.sessionId, projectPath: entry.projectPath, directory, ...(remember ? { remember } : {}) });

  const open = (index: number) => {
    const line = lines[index];
    if (line?.kind === 'more') { setLimit((value) => value + pageSize); return; }
    if (line?.kind !== 'session') return;
    const { entry } = line;
    if (entry.current) { onClose(null); return; }
    const blocker = openBlocker(entry, pid);
    if (blocker) { setNotice(blocker); return; }
    if (entry.inCurrentWorkspace) finish(entry, 'current');
    else if (directoryPreference !== 'ask') finish(entry, directoryPreference);
    else { setPending(entry); setDirectoryIndex(0); setNotice(''); }
  };
  const chooseDirectory = (index: number) => {
    const option = DIRECTORY_OPTIONS[index];
    if (!option || !pending) return;
    finish(pending, option.directory, option.remember ? option.directory : undefined);
  };

  const handleMouse = (mouse: SgrMouseInput) => {
    const row = mouse.row - 1;
    const column = mouse.column - 1;
    if (pending) {
      const option = row - DIRECTORY_OPTIONS_ROW;
      if (mouse.action !== 'press' || mouse.button !== 'left' || option < 0 || option >= DIRECTORY_OPTIONS.length) return;
      if (option === directoryIndex) chooseDirectory(option);
      else setDirectoryIndex(option);
      return;
    }
    if (mouse.action === 'wheel') { move(mouse.button === 'wheel-up' ? -WHEEL_ROWS : WHEEL_ROWS); return; }
    if (mouse.action !== 'press' || mouse.button !== 'left') return;
    if (row === TAB_ROW) {
      const tab = tabs.find((span) => column >= span.start && column < span.end);
      if (tab) openFilter(tab.filter);
      return;
    }
    const index = visibleTop + row - BODY_ROW;
    if (row < BODY_ROW || row >= BODY_ROW + bodyHeight || column >= listWidth || lineKey(lines[index]) === undefined) return;
    if (index === cursor.current) open(index);
    else select(index);
  };

  useInput((input, key) => {
    const mouse = parseSgrMouseInput(input);
    if (mouse) { handleMouse(mouse); return; }
    if (key.ctrl && input === 'c') { onClose(null); return; }
    if (pending) {
      if (key.escape) { setPending(undefined); return; }
      if (key.upArrow || key.downArrow) { setDirectoryIndex((index) => Math.max(0, Math.min(DIRECTORY_OPTIONS.length - 1, index + (key.upArrow ? -1 : 1)))); return; }
      if (/^[1-4]$/u.test(input)) { chooseDirectory(Number(input) - 1); return; }
      if (key.return) chooseDirectory(directoryIndex);
      return;
    }
    if (key.escape) { onClose(null); return; }
    if (key.tab) {
      const position = AGENT_SESSION_FILTERS.indexOf(filter);
      openFilter(AGENT_SESSION_FILTERS[(position + (key.shift ? AGENT_SESSION_FILTERS.length - 1 : 1)) % AGENT_SESSION_FILTERS.length]!);
      return;
    }
    if (key.return) { if (cursor.current >= 0) open(cursor.current); return; }
    if (key.upArrow || key.downArrow) { move(key.upArrow ? -1 : 1); return; }
    if (key.pageUp || key.pageDown) move((key.pageUp ? -1 : 1) * Math.max(1, bodyHeight - 1));
  });

  useEffect(() => { if (visibleTop !== offset) setOffset(visibleTop); }, [offset, visibleTop]);

  const accent = chalk.hex(colors.accent);
  const muted = chalk.hex(colors.muted);
  const statusColor = (entry: AgentSessionEntry) => entry.status === 'needs-you' ? chalk.hex(colors.warning)
    : entry.status === 'working' ? accent : entry.status === 'ready' ? chalk.hex(colors.success) : muted;
  const titleWidth = Math.max(8, listWidth - 4 - STATUS_WIDTH - UPDATED_WIDTH - 4);
  const at = now();

  const listCell = (line: OverviewLine | undefined, isSelected: boolean): string => {
    if (!line) return ' '.repeat(listWidth);
    if (line.kind === 'group') {
      const count = ` ${line.count}`;
      return chalk.bold(fit(`${abbreviatePath(line.projectPath, home, Math.max(8, listWidth - count.length))}${count}`, listWidth));
    }
    if (line.kind === 'more') {
      const text = fit(`${isSelected ? '›' : ' '} Show more (${line.remaining} older)`, listWidth);
      return isSelected ? `${INVERSE_ON}${text}${INVERSE_OFF}` : muted(text);
    }
    const { entry } = line;
    const cells = [
      `${isSelected ? '›' : ' '} ${entry.status === 'inactive' ? '○' : '●'} `,
      fit(entry.current ? `${entry.title} (this session)` : entry.title, titleWidth),
      '  ', fit(AGENT_SESSION_STATUS_LABELS[entry.status], STATUS_WIDTH),
      '  ', fit(formatAge(entry.activeAt, at), UPDATED_WIDTH),
    ];
    if (isSelected) return `${INVERSE_ON}${cells.join('')}${INVERSE_OFF}`;
    return `${statusColor(entry)(cells[0])}${cells[1]}${cells[2]}${statusColor(entry)(cells[3])}${cells[4]}${muted(cells[5])}`;
  };

  const paneLines = (): string[] => {
    if (!showPane) return [];
    if (!selected) return [muted(selectedLine?.kind === 'more' ? 'Load older saved sessions.' : 'No session selected.')];
    const prompt = prompts[selected.sessionId];
    const where = selected.current ? 'open here' : selected.livePid !== undefined ? `open in PID ${selected.livePid}` : 'saved';
    return [
      ...wrap(selected.title, paneWidth, 2).map((line) => chalk.bold(line)),
      '',
      `${statusColor(selected)(AGENT_SESSION_STATUS_LABELS[selected.status])}${muted(` · ${where}`)}`,
      ...(selected.phase && selected.status !== 'inactive' ? [muted(`Phase ${selected.phase.replace(/_/gu, ' ')}`)] : []),
      muted(`Model ${selected.model || 'unknown'}`),
      muted(`${selected.messageCount} messages · ${formatAge(selected.activeAt, at)}`),
      '',
      muted('Directory'),
      ...wrap(abbreviatePath(selected.projectPath, home, Number.MAX_SAFE_INTEGER), paneWidth, 3),
      ...(prompt ? ['', muted('First prompt'), ...wrap(prompt, paneWidth, Math.max(1, bodyHeight - 12))] : []),
    ];
  };

  const body = (): string[] => {
    if (pending) {
      return [
        chalk.bold(fit(`Working directory · ${pending.title}`, width - 1)),
        muted(fit('This session was last used in a different directory than the one you are in.', width - 1)),
        '',
        ...DIRECTORY_OPTIONS.map((option, index) => {
          const directory = option.directory === 'session' ? pending.projectPath : currentWorkspace;
          const text = fit(`${index === directoryIndex ? '›' : ' '} ${index + 1}. ${option.label}${option.remember ? '' : `  ${abbreviatePath(directory, home, Math.max(8, width - 34))}`}`, width - 1);
          return index === directoryIndex ? `${INVERSE_ON}${text}${INVERSE_OFF}` : text;
        }),
      ];
    }
    if (!snapshot) return [muted(error ? `Could not load sessions: ${error}` : 'Loading sessions…')];
    if (lines.length === 0) return [muted(entries.length === 0 ? 'No sessions yet.' : `No ${AGENT_SESSION_FILTER_LABELS[filter].toLowerCase()} sessions.`)];
    const pane = paneLines();
    return Array.from({ length: bodyHeight }, (_, row) => {
      const index = visibleTop + row;
      const cell = listCell(lines[index], index === selectedIndex);
      return showPane ? `${cell}${muted(PANE_RULE)}${pane[row] ?? ''}` : cell;
    });
  };

  const rendered = body();
  const position = selectable.indexOf(selectedIndex) + 1;
  const status = notice ? chalk.hex(colors.warning)(notice)
    : error && snapshot ? chalk.hex(colors.error)(`Refresh failed: ${error}`)
      : pending ? ''
        : !showPane && selected ? muted(`${abbreviatePath(selected.projectPath, home, Math.max(8, width - 30))} · ${selected.model || 'unknown model'}`)
          : selectable.length > 0 ? muted(`${position}/${selectable.length}`) : '';

  return <Box flexDirection="column" width={width} height={height}>
    <Text bold wrap="truncate">{`Agent sessions${muted(' · grouped by directory')}`}</Text>
    <Text wrap="truncate">{tabs.map((span) => span.filter === filter ? `${INVERSE_ON}${span.label}${INVERSE_OFF}` : muted(span.label)).join(TAB_GAP)}</Text>
    <Text> </Text>
    <Text wrap="truncate">{pending ? ' ' : muted(`${fit('    Session', listWidth - STATUS_WIDTH - UPDATED_WIDTH - 4)}  ${fit('Status', STATUS_WIDTH)}  ${fit('Updated', UPDATED_WIDTH)}${showPane ? `${PANE_RULE}Details` : ''}`)}</Text>
    {Array.from({ length: bodyHeight }, (_, index) => <Text key={index} wrap="truncate">{rendered[index] || ' '}</Text>)}
    <Text wrap="truncate">{status || ' '}</Text>
    <Text color={colors.muted} wrap="truncate">{pending
      ? '↑/↓ move · 1–4 or enter choose · esc back to sessions'
      : 'esc back · ↑/↓ move · tab filter · enter open'}</Text>
  </Box>;
}

export const AGENT_SESSIONS_LAYOUT = { TAB_ROW, BODY_ROW, DIRECTORY_OPTIONS_ROW } as const;

export async function showAgentSessionsScreen({ mouse = false, ...props }: ShowAgentSessionsScreenOptions): Promise<AgentSessionChoice | null> {
  let choice: AgentSessionChoice | null = null;
  prepareModalRender();
  if (mouse) process.stdout.write(ENABLE_SGR_MOUSE_TRACKING);
  try {
    const instance = render(<ThemeProvider><AgentSessionsScreen {...props} onClose={(value) => { choice = value; instance.unmount(); }} /></ThemeProvider>, { exitOnCtrlC: false });
    await instance.waitUntilExit();
  } finally {
    if (mouse) process.stdout.write(DISABLE_SGR_MOUSE_TRACKING);
    cleanupModalRender();
  }
  return choice;
}
