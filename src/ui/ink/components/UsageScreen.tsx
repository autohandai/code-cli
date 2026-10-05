/** @license Apache-2.0 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useInput, useWindowSize } from 'ink';
import chalk, { type ChalkInstance } from 'chalk';
import type { ResolvedColors } from '../../theme/types.js';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext.js';
import { prepareModalRender, cleanupModalRender } from './Modal.js';
import { aggregateUsageReport, type UsageDay, type UsageQuery, type UsageReportData } from '../../../usage/usageReport.js';
import type { SessionMetadata } from '../../../session/types.js';
import type { AccountEntitlement } from '../../../auth/AuthClient.js';
import type { WorkMap } from '../../../integrations/ahtraces/workMap.js';

export interface UsageScreenProps {
  account: string;
  loadReport: (query: UsageQuery, signal: AbortSignal) => Promise<UsageReportData>;
  loadAccount: (signal: AbortSignal) => Promise<AccountEntitlement | null>;
  loadTraces: (query: UsageQuery, signal: AbortSignal) => Promise<WorkMap | null>;
  onClose: () => void;
  initialDays?: 7 | 30;
  rows?: number;
  columns?: number;
}
const TABS = ['Overview', 'Usage', 'Messages', 'Extensions', 'Skills', 'Sessions', 'Traces'];
const SHORT_TABS = ['Home', 'Use', 'Msg', 'Ext', 'Skills', 'Chats', 'Traces'];
const clean = (value: string): string => stripAnsi(value).replace(/[\x00-\x1f\x7f]/gu, ' ');
const number = (value: number): string => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const duration = (ms: number): string => ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s` : `${Math.round(ms / 1000)}s`;
const clip = (value: string, width: number) => wrapAnsi(clean(value), Math.max(1, width), { hard: true }).split('\n')[0];

function chart(days: UsageDay[], selected: number, metric: 'tokens' | 'messages' | 'skills' | 'extensions', width: number, height: number, accent: string): string[] {
  const count = Math.min(days.length, Math.max(1, Math.floor((width - 7) / 8)));
  const start = Math.max(0, Math.min(days.length - count, selected - count + 1));
  const visible = days.slice(start, start + count);
  const peak = Math.max(1, ...days.map(day => day[metric]));
  const barWidth = Math.max(2, Math.floor((width - 7) / count) - 2);
  const lines = [visible.map(day => number(day[metric]).padStart(barWidth + 2)).join('')];
  for (let row = height; row > 0; row--) {
    lines.push(visible.map((day, i) => {
      const filled = Math.ceil(day[metric] / peak * height) >= row && day[metric] > 0;
      const bar = filled ? '█'.repeat(barWidth) : ' '.repeat(barWidth);
      return `  ${start + i === selected ? chalk.hex(accent)(bar) : chalk.dim(bar)}`;
    }).join(''));
  }
  lines.push(visible.map((day, i) => {
    const label = day.date.slice(5).padStart(barWidth + 2);
    return start + i === selected ? chalk.hex(accent).underline(label) : label;
  }).join(''));
  return lines;
}

interface ReportView {
  tab: number;
  data: UsageReportData;
  report: ReturnType<typeof aggregateUsageReport>;
  heatmap: ReturnType<typeof aggregateUsageReport>;
  sessions: SessionMetadata[];
  accountData: AccountEntitlement | null | undefined;
  trace: WorkMap | null | undefined;
  traceError: boolean;
  detail: SessionMetadata | undefined;
  row: number;
  sortTokens: boolean;
  days: number;
  selectedDay: number;
  activeDay: UsageDay;
  width: number;
  bodyHeight: number;
  colors: ResolvedColors;
  accent: ChalkInstance;
  muted: ChalkInstance;
}

function overviewLines({ report, accountData, heatmap, width, colors, accent, muted, data }: ReportView): string[] {
  const lines: string[] = [];
  lines.push(accent.bold('Activity overview'), `${number(report.tokens)} recorded tokens   ${report.sessions.length} sessions   ${number(report.messages)} messages`,
    `Longest recorded turn ${duration(report.longestTurnMs)}   Cache reads ${report.cacheRead === undefined ? 'unavailable' : number(report.cacheRead)}`,
    `${report.unknownSessions} sessions with unavailable token totals`, '', accent.bold('Account quota · API'));
  if (accountData === undefined) lines.push('Loading account quota…');
  else if (!accountData) lines.push('Account quota unavailable. Local activity is still available.');
  else {
    lines.push(clean(accountData.limits?.displayName ?? accountData.tier));
    if (accountData.limits) lines.push(`${number(accountData.limits.rpm)} requests/min · ${accountData.limits.inputTokensPerMinute === null ? 'uncapped' : number(accountData.limits.inputTokensPerMinute)} input tokens/min`);
    for (const [label, quota] of [['5 hours', accountData.quota?.window5h], ['24 hours', accountData.quota?.window24h], ['Week', accountData.quota?.week], ['Month', accountData.quota?.month]] as const) {
      if (!quota) continue;
      const ratio = quota.limit === null ? null : Math.max(0, Math.min(1, (quota.remaining ?? 0) / Math.max(1, quota.limit)));
      lines.push(`${label.padEnd(8)} ${ratio === null ? 'No request quota' : `${accent('━'.repeat(Math.round(ratio * 12)))}${muted('─'.repeat(12 - Math.round(ratio * 12)))} ${Math.round(ratio * 100)}% left`} · ${number(quota.used)} used`);
      if (quota.resetAt && Number.isFinite(Date.parse(quota.resetAt))) lines.push(muted(`         Resets ${new Date(quota.resetAt).toLocaleString()}`));
    }
    if (!accountData.quota?.available) lines.push('Quota window measurements unavailable.');
  }
  const weeks = Math.min(52, Math.max(1, Math.floor((width - 4) / 2)));
  lines.push('', accent.bold(`Token activity · last ${weeks} weeks`), muted('Session totals grouped by last active UTC day'));
  const end = new Date(heatmap.days.at(-1)!.date).getUTCDay();
  const grid = [...heatmap.days, ...Array.from({ length: 6 - end }, () => undefined)].slice(-weeks * 7);
  const peak = Math.max(1, ...heatmap.days.map(day => day.tokens));
  for (let weekday = 0; weekday < 7; weekday++) {
    let line = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][weekday] + '  ';
    for (let week = 0; week < weeks; week++) {
      const value = grid[week * 7 + weekday]?.tokens ?? 0;
      line += (value ? chalk.hex(colors.accent)(value > peak / 2 ? '█' : '▒') : muted('·')) + ' ';
    }
    lines.push(line);
  }
  lines.push('', ...data.warnings.map(warning => `! ${warning}`));

  return lines;
}

function sessionLines({ sessions, detail, row, sortTokens, width, accent }: ReportView): string[] {
  const lines: string[] = [];
  const selected = detail;
  if (detail && selected) {
    lines.push(accent.bold(clean(selected.title ?? selected.summary ?? selected.sessionId)), '', `Model: ${clean(selected.model)}`, `Project: ${clean(selected.projectPath)}`,
      `Status: ${clean(selected.status)}`, `Messages (all roles): ${selected.messageCount}`, `Recorded tokens: ${selected.usage?.tokenUsageStatus === 'actual' ? number(selected.usage.totalTokens) : 'unavailable'}`,
      `Input: ${selected.usage?.promptTokens ?? 'unavailable'}   Output: ${selected.usage?.completionTokens ?? 'unavailable'}`, `Turns: ${selected.usage?.turnCount ?? 'unavailable'}`,
      `Created: ${clean(selected.createdAt)}`, `Last active: ${clean(selected.lastActiveAt)}`, `Session: ${clean(selected.sessionId)}`, '', 'Esc returns to the session list.');
  } else {
    lines.push(`Sessions · sorted by ${sortTokens ? 'recorded tokens' : 'recent activity'} · Enter details`, '');
    for (const [index, session] of sessions.entries()) {
      const value = session.usage?.tokenUsageStatus === 'actual' ? number(session.usage.totalTokens) : '—';
      const label = `${index === row ? '›' : ' '} ${clip(session.title ?? session.summary ?? session.sessionId, width - 16).padEnd(width - 15)} ${value}`;
      lines.push(index === row ? accent(label) : label);
    }
    if (!sessions.length) lines.push('No sessions in this period. Try r or p.');
  }

  return lines;
}

function traceLines({ trace, traceError, accent }: ReportView): string[] {
  const lines: string[] = [];
  lines.push(accent.bold('Traces · local ahtraces aggregates'), '');
  if (traceError) lines.push('Trace data unavailable. Press R to retry; check /traces status.');
  else if (trace === undefined) lines.push('Loading trace insights…');
  else if (trace === null) lines.push('Trace monitoring is not enabled.', 'Enable local monitoring in /settings to see these insights.');
  else {
    lines.push(`${trace.sessions.total} sessions · ${number(trace.sessions.tokens)} tokens · ${duration(trace.sessions.durationMs)}`,
      `Verified ${trace.outcomes.verified} · unverified ${trace.outcomes.completedUnverified} · failed ${trace.outcomes.failed}`,
      `Usage: ${trace.sessions.usageProvenance.actual} actual / ${trace.sessions.usageProvenance.estimated} estimated / ${trace.sessions.usageProvenance.unavailable} unavailable`,
      `Coverage: ${trace.coverage.filesScanned} files · ${trace.coverage.partial ? 'partial' : 'complete within requested scan'} · ${trace.coverage.warnings} warnings`, '', accent.bold('Verification'),
      `Tests passed ${trace.verification.testsPassed} · failed ${trace.verification.testsFailed}`, `Lint ${trace.verification.lintPassed} · build ${trace.verification.buildPassed} · proof ${trace.verification.proofPassed}`, '', accent.bold('Tools'));
    for (const tool of trace.tools) lines.push(`${tool.category.padEnd(12)} ${tool.calls} calls · ${tool.errors} errors`);
    for (const [label, entries] of Object.entries(trace.dimensions)) {
      lines.push('', accent.bold(label));
      for (const entry of entries) lines.push(`${clean(entry.name)}  ${entry.sessions} sessions · ${number(entry.tokens)} tokens`);
    }
    lines.push('', accent.bold('Workflows'));
    for (const workflow of trace.workflows) lines.push(`${clean(workflow.motif)} · ${workflow.occurrences} observed · ${workflow.verified} verified`);
    lines.push('', `Updated ${clean(trace.generatedAt)}`, 'Trace totals are separate; they may include these local sessions.');
  }

  return lines;
}

function activityLines({ tab, report, days, selectedDay, activeDay, width, bodyHeight, colors, accent, muted, data }: ReportView): string[] {
  const lines: string[] = [];
  const metric = (['', 'tokens', 'messages', 'extensions', 'skills'] as const)[tab] || 'tokens';
  const title = tab === 1 ? 'Session tokens' : tab === 2 ? 'Messages · all roles' : tab === 3 ? 'Recorded extension capability uses' : 'Recorded skill activations';
  lines.push(accent.bold(title), tab < 3 ? muted('Session totals grouped by last active UTC day') : muted('Project ledger · observed activations, not inferred tool calls'));
  lines.push(...chart(report.days, selectedDay, metric, width, Math.max(3, Math.min(10, bodyHeight - 7)), colors.accent));
  lines.push('', `${activeDay.date} · ${number(activeDay[metric])} ${metric} · ${activeDay.sessions} sessions`);
  if (tab < 3) {
    const models = new Map<string, number>();
    for (const session of report.sessions.filter(session => new Date(session.lastActiveAt).toISOString().slice(0, 10) === activeDay.date)) {
      const value = tab === 2 ? session.messageCount : session.usage?.tokenUsageStatus === 'actual' ? session.usage.totalTokens : 0;
      models.set(session.model, (models.get(session.model) ?? 0) + value);
    }
    lines.push('', 'Model breakdown');
    for (const [model, value] of [...models].sort((a, b) => b[1] - a[1])) lines.push(`${clean(model)}  ${number(value)}`);
  } else {
    const totals = tab === 3 ? report.extensions : report.skills;
    lines.push('', `Most used · ${days} days`);
    for (const total of totals) lines.push(`${clean(total.name)} · ${total.uses} uses · ${total.failed} failed · ${clean(total.source)}`);
    if (!totals.length) lines.push('No recorded uses in this period.');
    if (tab === 3) {
      lines.push('', 'Installed extensions · current workspace');
      for (const extension of data.extensions) lines.push(`${clean(extension.name)} · ${extension.enabled ? 'enabled' : 'disabled'} · ${extension.scope} · ${extension.skills} skills / ${extension.tools} tools`);
      if (!data.extensions.length) lines.push('No extensions installed.');
    }
  }

  return lines;
}

export function UsageScreen({ account, loadReport, loadAccount, loadTraces, onClose, initialDays = 7, rows, columns }: UsageScreenProps) {
  const size = useWindowSize();
  const height = rows ?? size.rows;
  const width = Math.max(20, (columns ?? size.columns) - 1);
  const bodyHeight = Math.max(1, height - 8);
  const { colors } = useTheme();
  const accent = chalk.hex(colors.accent);
  const muted = chalk.hex(colors.muted);
  const [tab, setTab] = useState(0);
  const [days, setDays] = useState<7 | 30>(initialDays);
  const [scope, setScope] = useState<UsageQuery['scope']>('project');
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<UsageReportData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [accountData, setAccountData] = useState<AccountEntitlement | null>();
  const [trace, setTrace] = useState<WorkMap | null>();
  const [traceError, setTraceError] = useState(false);
  const [selectedDay, setSelectedDay] = useState(initialDays - 1);
  const [row, setRow] = useState(0);
  const [detail, setDetail] = useState<SessionMetadata>();
  const [help, setHelp] = useState(false);
  const [sortTokens, setSortTokens] = useState(true);
  const query = useMemo(() => ({ scope, days }), [scope, days]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false); setData(undefined);
    void loadReport(query, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadReport, query, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setAccountData(undefined);
    void loadAccount(controller.signal).then(result => { if (!controller.signal.aborted) setAccountData(result); })
      .catch(() => { if (!controller.signal.aborted) setAccountData(null); });
    return () => controller.abort();
  }, [loadAccount, refresh]);
  useEffect(() => {
    if (tab !== 6) return;
    const controller = new AbortController();
    setTrace(undefined); setTraceError(false);
    void loadTraces(query, controller.signal).then(result => { if (!controller.signal.aborted) setTrace(result); })
      .catch(() => { if (!controller.signal.aborted) setTraceError(true); });
    return () => controller.abort();
  }, [tab, query, refresh, loadTraces]);

  const report = useMemo(() => aggregateUsageReport(data?.sessions ?? [], data?.capabilities ?? [], days, new Date(data?.generatedAt ?? Date.now())), [data, days]);
  const sessions = useMemo(() => [...report.sessions].sort((a, b) => sortTokens
    ? (b.usage?.tokenUsageStatus === 'actual' ? b.usage.totalTokens : -1) - (a.usage?.tokenUsageStatus === 'actual' ? a.usage.totalTokens : -1)
    : b.lastActiveAt.localeCompare(a.lastActiveAt)), [report, sortTokens]);
  const activeDay = report.days[Math.min(selectedDay, report.days.length - 1)];
  const heatmap = useMemo(() => aggregateUsageReport(data?.sessions ?? [], [], 365, new Date(data?.generatedAt ?? Date.now())), [data]);
  const lines: string[] = [];
  if (help) {
    lines.push('Keyboard controls', '', 'Tab / Shift+Tab or 1–7  Switch report', '← / →  Select day in a chart', '↑ / ↓ and PgUp / PgDn  Browse rows', 'Enter  Session details', 's  Sort sessions by tokens or recent activity', 'r  Toggle 7 / 30 days', 'p  Toggle this project / all local projects', 'R  Refresh data', 'Esc  Back / close', 'Ctrl+C  Close report', '', 'Sources', 'Account plan and quota: Autohand API.', 'Tokens/messages: local session metadata, all message roles.', 'Charts group entire session totals by last active UTC day.', 'Skills/extensions: recorded project capability events.', 'Traces: optional local ahtraces Work Map; never added to session totals.', 'Missing token usage remains unavailable; it is not estimated.');
  } else if (loading) lines.push('Loading local activity…');
  else if (error) lines.push('Unable to load local activity. Press R to retry.');
  else if (data) {
    const view: ReportView = { tab, data, report, heatmap, sessions, accountData, trace, traceError, detail, row, sortTokens, days, selectedDay, activeDay, width, bodyHeight, colors, accent, muted };
    lines.push(...(tab === 0 ? overviewLines(view) : tab === 5 ? sessionLines(view) : tab === 6 ? traceLines(view) : activityLines(view)));
  }
  const wrapped = lines.flatMap(line => wrapAnsi(line, width, { hard: true, trim: false }).split('\n'));
  const offset = tab === 5 && !detail && !help ? Math.max(0, Math.min(wrapped.length - bodyHeight, row - bodyHeight + 4)) : Math.min(row, Math.max(0, wrapped.length - bodyHeight));
  const visible = wrapped.slice(offset, offset + bodyHeight);
  while (visible.length < bodyHeight) visible.push(' ');
  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onClose(); return; }
    if (key.escape || input === 'q') {
      if (help) { setHelp(false); setRow(0); } else if (detail) { setRow(Math.max(0, sessions.findIndex(session => session.sessionId === detail.sessionId))); setDetail(undefined); } else onClose();
      return;
    }
    if (key.tab || /^[1-7]$/u.test(input)) {
      setTab(key.tab ? (tab + (key.shift ? 6 : 1)) % 7 : Number(input) - 1); setRow(0); setDetail(undefined); setHelp(false); return;
    }
    if (input === '?') { setHelp(value => !value); setRow(0); return; }
    if (input === 'r') { setDays(days === 7 ? 30 : 7); setSelectedDay(days === 7 ? 29 : 6); setRow(0); setDetail(undefined); return; }
    if (input === 'p') { setScope(scope === 'project' ? 'all' : 'project'); setRow(0); setDetail(undefined); return; }
    if (input === 'R') { setRefresh(value => value + 1); setRow(0); setDetail(undefined); return; }
    if (input === 's' && tab === 5) { setSortTokens(value => !value); setRow(0); setDetail(undefined); return; }
    if (key.return && tab === 5 && !detail && !help && sessions.length) { setDetail(sessions[row]); setRow(0); return; }
    if (key.leftArrow || key.rightArrow) { setSelectedDay(value => Math.max(0, Math.min(days - 1, value + (key.leftArrow ? -1 : 1)))); setRow(0); return; }
    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
      const max = tab === 5 && !detail && !help ? Math.max(0, sessions.length - 1) : Math.max(0, wrapped.length - bodyHeight);
      const delta = (key.upArrow || key.pageUp ? -1 : 1) * (key.pageUp || key.pageDown ? bodyHeight : 1);
      setRow(value => Math.max(0, Math.min(max, value + delta)));
    }
  });
  return <Box flexDirection="column" width={width} height={Math.max(8, height - 1)}>
    <Text bold wrap="truncate">Usage · {clean([accountData?.limits?.displayName ?? accountData?.tier, account].filter(Boolean).join(' · '))}</Text>
    <Text wrap="truncate">{(width < 78 ? SHORT_TABS : TABS).map((name, index) => index === tab ? accent.bold(`${index + 1} ${name}`) : muted(`${index + 1} ${name}`)).join('  ')}</Text>
    <Text color={colors.muted} wrap="truncate">{`r ${days}d · p ${scope === 'project' ? 'This project' : 'All local projects'} · ${TABS[tab]}${help ? ' help' : ''}`}</Text>
    <Text> </Text>
    {visible.map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
    <Text color={colors.muted} wrap="truncate">{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()} · ${data.sessions.length}/${data.totalSessions} loaded${data.warnings.length ? ' · partial data' : ''} · ${offset + 1}–${Math.min(offset + bodyHeight, wrapped.length)}/${wrapped.length}` : 'Local activity and account quota'}</Text>
    <Text color={colors.muted} wrap="truncate">Tab/1–7 report · ←→ day · ↑↓ scroll · Enter details</Text>
    <Text color={colors.muted} wrap="truncate">r range · p scope · R refresh · ? help · Esc back</Text>
  </Box>;
}

export async function showUsageScreen(props: Omit<UsageScreenProps, 'onClose'>): Promise<void> {
  prepareModalRender();
  try {
    const instance = render(<ThemeProvider><UsageScreen {...props} onClose={() => instance.unmount()} /></ThemeProvider>, { exitOnCtrlC: false });
    await instance.waitUntilExit();
  } finally { cleanupModalRender(); }
}
