/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useCallback, useRef, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { Team, TeamTask } from '../../core/teams/types.js';
import { useTheme } from '../theme/ThemeContext.js';
import type { ColorToken } from '../theme/types.js';
import { summarizeTaskOutcomes } from '../taskPanelModel.js';
import { sanitizeAnnouncementText } from '../../announcements/AnnouncementContent.js';
import { DEFAULT_KEYBINDINGS, actionShortcutHint, type ResolvedKeybindings } from '../../keybindings/profiles.js';

export interface TeamPanelProps {
  team: Team;
  tasks: TeamTask[];
  onHide?: () => void;
  onCommand?: (command: string) => void;
  onCtrlC?: () => void;
  keybindings?: ResolvedKeybindings;
  terminalRows?: number;
  terminalColumns?: number;
}

type TeamPanelMode = { kind: 'list' } | { kind: 'details'; offset: number }
  | { kind: 'confirm'; command: string; question: string };

function clean(value: string): string {
  return sanitizeAnnouncementText(value, { maxCharacters: 8192, preserveParagraphs: true });
}

const StatusIcon = memo(({ status }: { status: string }) => {
  const { theme } = useTheme();
  const icon = (token: ColorToken, value: string) => <Text>{theme.fg(token, value)}</Text>;

  switch (status) {
    case 'completed': return icon('success', '✓');
    case 'in_progress': return icon('warning', '●');
    case 'working': return icon('warning', '●');
    case 'idle': return icon('success', '○');
    case 'shutdown': return icon('error', '×');
    case 'failed': return icon('error', '×');
    case 'cancelled': return icon('muted', '⊘');
    case 'spawning': return icon('muted', '…');
    default: return icon('muted', '○');
  }
});
StatusIcon.displayName = 'StatusIcon';

export const TeamPanel = memo(({ team, tasks, onHide, onCommand, onCtrlC,
  keybindings = DEFAULT_KEYBINDINGS, terminalRows = 24, terminalColumns = 80 }: TeamPanelProps) => {
  const { theme } = useTheme();
  const outcome = summarizeTaskOutcomes(tasks);
  const done = outcome.completed;
  const [selectedId, setSelectedId] = useState(tasks[0]?.id);
  const [mode, setMode] = useState<TeamPanelMode>({ kind: 'list' });
  const selectedIndex = Math.max(0, tasks.findIndex(task => task.id === selectedId));
  const selected = tasks[selectedIndex];
  const interactive = Boolean(onHide && onCommand);
  const rows = Math.max(2, terminalRows - 9);
  const hideHint = `${actionShortcutHint(keybindings, 'toggleTeamPanel', '/team hide')} hide`;
  const details = selected ? clean([selected.error ?? 'No error recorded.', selected.output ?? 'No output recorded.'].join('\n\n')) : 'Task unavailable.';
  const detailLines = wrapAnsi(details, Math.max(1, terminalColumns - 2), { hard: true, trim: false }).split('\n');

  const handleInput = useRef<(input: string, key: Key) => void>(() => {});
  handleInput.current = (input, key) => {
    if (key.ctrl && input === 'c') { onCtrlC?.(); return; }
    if (keybindings.matches('toggleTeamPanel', { input, ctrl: key.ctrl, shift: key.shift, meta: key.meta })) { onHide?.(); return; }
    if (key.escape) {
      if (mode.kind === 'list') onHide?.();
      else setMode({ kind: 'list' });
      return;
    }
    if (mode.kind === 'confirm') {
      if (input.toLowerCase() === 'y') {
        onHide?.();
        onCommand?.(mode.command);
      } else if (input.toLowerCase() === 'n') setMode({ kind: 'list' });
      return;
    }
    if (mode.kind === 'details') {
      if (key.upArrow || key.downArrow) setMode({ kind: 'details', offset: Math.max(0,
        Math.min(Math.max(0, detailLines.length - rows), mode.offset + (key.downArrow ? 1 : -1))) });
      return;
    }
    if (key.upArrow || key.downArrow) {
      setSelectedId(tasks[Math.max(0, Math.min(tasks.length - 1, selectedIndex + (key.downArrow ? 1 : -1)))]?.id);
    } else if (key.return && selected) setMode({ kind: 'details', offset: 0 });
    else if (input.toLowerCase() === 'h') onHide?.();
    else if (input.toLowerCase() === 's' && team.status === 'active') {
      setMode({ kind: 'confirm', command: '/team shutdown', question: 'Shut down this team and stop its workers?' });
    } else if (input.toLowerCase() === 'r' && selected?.status === 'failed' && team.status === 'active') {
      setMode({ kind: 'confirm', command: `/team retry ${selected.id}`, question: `Retry ${clean(selected.subject)}?` });
    } else if (input.toLowerCase() === 'a' && outcome.failed > 0 && team.status === 'active') {
      setMode({ kind: 'confirm', command: '/team retry-failed', question: `Retry ${outcome.failed} failed tasks?` });
    }
  };
  useInput(useCallback((input, key) => handleInput.current(input, key), []), { isActive: interactive });

  if (mode.kind !== 'list') return <Box flexDirection="column">
    <Text bold>Team: {clean(team.name)}</Text>
    {mode.kind === 'confirm' ? <Text>{mode.question} y confirm · n keep team</Text> : <>
      <Text bold>{clean(selected?.subject ?? 'Task unavailable')} · {selected?.status}</Text>
      {detailLines.slice(mode.offset, mode.offset + rows).map((line, index) => <Text key={index}>{line}</Text>)}
      <Text>↑/↓ scroll · Esc back</Text>
    </>}
  </Box>;

  const taskLimit = interactive ? Math.max(1, Math.floor(rows / 2)) : tasks.length;
  const taskStart = Math.max(0, selectedIndex - taskLimit + 1);
  const visibleTasks = tasks.slice(taskStart, taskStart + taskLimit);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box gap={1}>
        <Text bold>Team: {clean(team.name)}</Text>
        <Text>{theme.fg(team.status === 'active' ? 'success' : 'muted', `● ${team.status === 'active' ? 'workers available' : 'closed'}`)}</Text>
        <Text>{theme.fg('muted', `· ${hideHint}`)}</Text>
      </Box>
      {outcome.settled ? <Text>{theme.fg(outcome.failed ? 'error' : 'muted', outcome.label)}</Text> : null}
      {interactive ? <Text>↑/↓ select · Enter inspect · r retry selected · a retry failed · s shut down team · h hide</Text> : null}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Tasks [{done}/{tasks.length} done]</Text>
        {visibleTasks.map((task) => (
          <Box key={task.id} gap={1}>
            {interactive ? <Text>{task.id === selected?.id ? '›' : ' '}</Text> : null}
            <StatusIcon status={task.status} />
            <Text>{clean(task.subject)}</Text>
            {task.status === 'failed' || task.status === 'cancelled' ? (
              <Text>{theme.fg(task.status === 'failed' ? 'error' : 'muted', `[${task.status}]`)}</Text>
            ) : null}
            {task.owner && <Text>{theme.fg('accent', ` → ${task.owner}`)}</Text>}
          </Box>
        ))}
        {tasks.length === 0 && <Text>{theme.fg('muted', '  No tasks yet')}</Text>}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Teammates</Text>
        {team.members.slice(0, interactive ? Math.max(1, rows - visibleTasks.length - 2) : team.members.length).map((member) => (
          <Box key={member.name} gap={1}>
            <StatusIcon status={member.status} />
            <Text>{member.name}</Text>
            <Text>{theme.fg(
              'muted',
              `(${member.agentName}${member.provider && member.model ? ` · ${member.provider} · ${member.model}` : member.model ? ` · ${member.model}` : ''}${member.status === 'shutdown' ? `; exit ${member.exitCode ?? 'unknown'}` : ''})`,
            )}</Text>
          </Box>
        ))}
        {team.members.length === 0 && <Text>{theme.fg('muted', '  No teammates yet')}</Text>}
      </Box>
    </Box>
  );
});
TeamPanel.displayName = 'TeamPanel';
