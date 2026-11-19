/** @license Apache-2.0 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useInput, useWindowSize } from 'ink';
import chalk, { type ChalkInstance } from 'chalk';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext.js';
import { prepareModalRender, cleanupModalRender } from './Modal.js';
import { DISABLE_SGR_MOUSE_TRACKING, ENABLE_SGR_MOUSE_TRACKING, parseSgrMouseInput, type SgrMouseInput } from '../mouseInput.js';
import { aggregateUsageReport, usageIntensityCell, type CapabilityTotal, type UsageDay, type UsageQuery, type UsageReportData } from '../../../usage/usageReport.js';
import type { SessionMetadata } from '../../../session/types.js';
import type { AccountEntitlement } from '../../../auth/AuthClient.js';
import type { WorkMap } from '../../../integrations/ahtraces/workMap.js';

export interface UsageScreenProps {
  account: string;
  autohandCloud?: boolean;
  loadReport: (query: UsageQuery, signal: AbortSignal) => Promise<UsageReportData>;
  loadAccount: (signal: AbortSignal) => Promise<AccountEntitlement | null>;
  loadTraces: (query: UsageQuery, signal: AbortSignal) => Promise<WorkMap | null>;
  onClose: () => void;
  initialDays?: 7 | 30;
  rows?: number;
  columns?: number;
}
export interface ShowUsageScreenOptions extends Omit<UsageScreenProps, 'onClose'> {
  /** Report clicks and the wheel to the screen. Terminal mouse reporting replaces native text selection while the report is open. */
  mouse?: boolean;
}
const TABS = ['Overview', 'Usage', 'Messages', 'Extensions', 'Skills', 'Sessions', 'Traces'];
const SHORT_TABS = ['Home', 'Use', 'Msg', 'Ext', 'Skills', 'Chats', 'Traces'];
const TAB_GAP = '  ';
const clean = (value: string): string => stripAnsi(value).replace(/[\x00-\x1f\x7f]/gu, ' ');
const number = (value: number): string => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const duration = (ms: number): string => ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s` : `${Math.round(ms / 1000)}s`;
const clip = (value: string, width: number) => wrapAnsi(clean(value), Math.max(1, width), { hard: true }).split('\n')[0];
const plural = (value: number, noun: string): string => `${number(value)} ${noun}${value === 1 ? '' : 's'}`;
const TAB_ROW = 1;
const BODY_ROW = 4;
const WHEEL_ROWS = 3;
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const ACTIVITY_LABEL_WIDTH = 4;

function tabLabels(width: number): string[] {
  return (width < 78 ? SHORT_TABS : TABS).map((name, index) => `${index + 1} ${name}`);
}

/** The tab under a 0-based column of the tab bar, ignoring labels the terminal width cut off. */
function tabAt(column: number, width: number): number | undefined {
  const labels = tabLabels(width);
  const total = labels.join(TAB_GAP).length;
  const visibleEnd = total <= width ? total : width - 1;
  let start = 0;
  for (const [index, label] of labels.entries()) {
    const end = start + label.length;
    if (column >= start && column < end) return end <= visibleEnd ? index : undefined;
    start = end + TAB_GAP.length;
  }
  return undefined;
}

type ChartMetric = 'tokens' | 'messages' | 'skills' | 'extensions';
const METRIC_UNIT: Record<ChartMetric, string> = { tokens: 'token', messages: 'message', skills: 'skill activation', extensions: 'extension use' };
const PARTIAL_BLOCKS = ' ▁▂▃▄▅▆▇';
const WIDEST_SLOT = 13;
const NARROWEST_SLOT = 3;
/** A slot this wide holds any compact value or date plus a separating space. */
const LABELLED_SLOT = 7;

/** What a left click on a report cell selects. */
type UsageClick =
  | { kind: 'tab'; tab: number }
  | { kind: 'day'; day: number }
  | { kind: 'activity'; date: string }
  | { kind: 'session'; row: number };
/** A report row; `click` resolves a 0-based column on that row to its target, if it has one. */
interface ReportLine { text: string; click?: (column: number) => UsageClick | undefined }
type ReportRow = string | ReportLine;

interface ChartLayout { start: number; count: number; slot: number; bar: number }

/** Every day of the range gets a slot when the width allows three cells each; otherwise a window follows the selected day. */
function chartLayout(dayCount: number, selected: number, width: number): ChartLayout {
  const slot = Math.max(NARROWEST_SLOT, Math.min(WIDEST_SLOT, Math.floor(width / dayCount)));
  const count = Math.max(1, Math.min(dayCount, Math.floor(width / slot)));
  const start = Math.max(0, Math.min(dayCount - count, selected - count + 1));
  return { start, count, slot, bar: slot > LABELLED_SLOT ? slot - 2 : slot - 1 };
}

/**
 * Right-aligns labels under their slots. Slots narrower than a label are labelled at a fixed stride from the newest day,
 * so the axis stays put while the selection moves; the selected day is always labelled and displaces its neighbours.
 */
function labelRow(labels: Array<string | undefined>, selected: number, { slot }: ChartLayout, highlight: ChalkInstance): string {
  const cells: Array<{ char: string; selected: boolean }> = Array.from({ length: labels.length * slot }, () => ({ char: ' ', selected: false }));
  const stride = Math.max(1, Math.ceil((Math.max(...labels.map(label => label?.length ?? 0)) + 1) / slot));
  const order = [selected];
  for (let index = labels.length - 1; index >= 0; index -= stride) order.push(index);
  for (const index of order) {
    const label = labels[index];
    if (!label || label.length > cells.length) continue;
    const from = Math.max(0, Math.min(cells.length - label.length, (index + 1) * slot - label.length));
    if (cells.slice(Math.max(0, from - 1), from + label.length + 1).some(cell => cell.char !== ' ')) continue;
    for (const [offset, char] of [...label].entries()) cells[from + offset] = { char, selected: index === selected };
  }
  const text = (from: number, to: number) => cells.slice(from, to).map(cell => cell.char).join('');
  const first = cells.findIndex(cell => cell.selected);
  if (first < 0) return text(0, cells.length);
  const end = first + cells.filter(cell => cell.selected).length;
  return `${text(0, first)}${highlight(text(first, end))}${text(end, cells.length)}`;
}

function chart(days: UsageDay[], selected: number, metric: ChartMetric, width: number, height: number, accent: ChalkInstance, muted: ChalkInstance): ReportLine[] {
  const layout = chartLayout(days.length, selected, width);
  const { start, count, slot, bar } = layout;
  const visible = days.slice(start, start + count);
  const active = selected - start;
  const peak = Math.max(1, ...days.map(day => day[metric]));
  const eighths = visible.map(day => day[metric] > 0 ? Math.max(1, Math.round(day[metric] / peak * height * 8)) : 0);
  const labelled = slot >= LABELLED_SLOT;
  const click = (column: number): UsageClick | undefined => {
    const index = Math.floor(column / slot);
    return index < count ? { kind: 'day', day: start + index } : undefined;
  };
  const rows = [labelRow(visible.map((day, index) => labelled || index === active ? number(day[metric]) : undefined), active, layout, accent.bold)];
  for (let row = height; row > 0; row--) {
    rows.push(eighths.map((filled, index) => {
      const level = Math.max(0, Math.min(8, filled - (row - 1) * 8));
      const cell = (level === 8 ? '█' : PARTIAL_BLOCKS[level]).repeat(bar);
      return ' '.repeat(slot - bar) + (level === 0 ? cell : index === active ? accent(cell) : accent.dim(cell));
    }).join(''));
  }
  rows.push(labelRow(visible.map(day => day.date.slice(5)), active, layout, accent.underline));
  const lines: ReportLine[] = rows.map(text => ({ text, click }));
  if (count < days.length) lines.push({ text: muted(`${visible[0].date.slice(5)} – ${visible.at(-1)!.date.slice(5)} of ${days.length} days · ← → moves the window`) });
  return lines;
}

interface ReportView {
  autohandCloud: boolean;
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
  activityDate: string | undefined;
  activeDay: UsageDay;
  width: number;
  bodyHeight: number;
  accent: ChalkInstance;
  muted: ChalkInstance;
}

function skillSummary(report: ReportView['report']): string {
  const [latest] = [...report.skillHistory].sort((a, b) => Date.parse(b.lastUsed) - Date.parse(a.lastUsed));
  if (!report.skills.length) return latest ? `No skills used in this period · last ${clean(latest.name)} on ${latest.lastUsed.slice(0, 10)}` : 'No skill activations recorded';
  const top = report.skills.slice(0, 3).map(skill => `${clean(skill.name)} ×${skill.uses}`).join(', ');
  return `Skills used: ${top}${report.skills.length > 3 ? ` +${report.skills.length - 3} more` : ''}`;
}

function overviewLines({ report, accountData, heatmap, width, activityDate, accent, muted, data, autohandCloud }: ReportView): ReportRow[] {
  const lines: ReportRow[] = [];
  lines.push(accent.bold('Activity overview'), `${number(report.tokens)} recorded tokens   ${report.sessions.length} sessions   ${number(report.messages)} messages`,
    `Longest recorded turn ${duration(report.longestTurnMs)}   Cache reads ${report.cacheRead === undefined ? 'unavailable' : number(report.cacheRead)}`,
    `${report.unknownSessions} sessions with unavailable token totals`, skillSummary(report), '', accent.bold(autohandCloud ? 'Account quota · API' : 'Provider usage'));
  if (!autohandCloud) lines.push('No Autohand rate limits or quotas apply to this provider.');
  else if (accountData === undefined) lines.push('Loading account quota…');
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
  const weeks = Math.min(52, Math.max(1, Math.floor((width - ACTIVITY_LABEL_WIDTH) / 2)));
  lines.push('', accent.bold(`Token activity · last ${weeks} weeks`), muted('Session totals grouped by last active UTC day'));
  const end = new Date(heatmap.days.at(-1)!.date).getUTCDay();
  const grid = [...heatmap.days, ...Array.from({ length: 6 - end }, () => undefined)].slice(-weeks * 7);
  const peak = Math.max(1, ...heatmap.days.map(day => day.tokens));
  for (let weekday = 0; weekday < 7; weekday++) {
    let text = WEEKDAYS[weekday].padEnd(ACTIVITY_LABEL_WIDTH);
    for (let week = 0; week < weeks; week++) {
      const day = grid[week * 7 + weekday];
      const cell = usageIntensityCell(day?.tokens ?? 0, peak);
      const paint = cell === '·' ? muted : accent;
      text += `${day && day.date === activityDate ? paint.inverse(cell) : paint(cell)} `;
    }
    lines.push({ text, click: column => {
      const offset = column - ACTIVITY_LABEL_WIDTH;
      const day = offset >= 0 && offset % 2 === 0 ? grid[offset / 2 * 7 + weekday] : undefined;
      return day ? { kind: 'activity', date: day.date } : undefined;
    } });
  }
  lines.push(`${muted('Less ·')} ${accent('░ ▒ ▓ █')} ${muted('More')}`);
  const chosen = heatmap.days.find(day => day.date === activityDate);
  if (chosen) lines.push(accent(`${chosen.date} · ${plural(chosen.tokens, 'token')} · ${plural(chosen.sessions, 'session')} · ${plural(chosen.messages, 'message')}`));
  lines.push('', ...data.warnings.map(warning => `! ${warning}`));

  return lines;
}

function sessionLines({ sessions, detail, row, sortTokens, width, accent }: ReportView): ReportRow[] {
  const lines: ReportRow[] = [];
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
      lines.push({ text: index === row ? accent(label) : label, click: () => ({ kind: 'session', row: index }) });
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

const skillLine = (skill: CapabilityTotal): string =>
  `${clean(skill.name)} · ${plural(skill.uses, 'use')} · ${skill.byUser} by you · ${skill.byAgent} by agent · ${skill.failed} failed · ${clean(skill.source)}`;

function activityLines({ tab, report, days, selectedDay, activeDay, width, bodyHeight, accent, muted, data }: ReportView): ReportRow[] {
  const lines: ReportRow[] = [];
  const metric = (['', 'tokens', 'messages', 'extensions', 'skills'] as const)[tab] || 'tokens';
  const title = tab === 1 ? 'Session tokens' : tab === 2 ? 'Messages · all roles' : tab === 3 ? 'Recorded extension capability uses' : 'Recorded skill activations';
  lines.push(accent.bold(title), tab < 3 ? muted('Session totals grouped by last active UTC day') : muted('Project ledger · observed activations, not inferred tool calls'));
  lines.push(...chart(report.days, selectedDay, metric, width, Math.max(3, Math.min(10, bodyHeight - 7)), accent, muted));
  lines.push('', `${activeDay.date} · ${plural(activeDay[metric], METRIC_UNIT[metric])} · ${plural(activeDay.sessions, 'session')}`);
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
    for (const total of totals) lines.push(tab === 4 ? skillLine(total) : `${clean(total.name)} · ${total.uses} uses · ${total.failed} failed · ${clean(total.source)}`);
    if (!totals.length) lines.push('No recorded uses in this period.');
    const recorded = (skills: CapabilityTotal[]) => skills.reduce((sum, skill) => sum + skill.uses, 0);
    if (tab === 4 && recorded(report.skillHistory) > recorded(report.skills)) {
      lines.push('', 'All recorded activations · including earlier periods');
      for (const skill of report.skillHistory) lines.push(`${clean(skill.name)} · ${plural(skill.uses, 'use')} · last ${skill.lastUsed.slice(0, 10)} · ${clean(skill.source)}`);
    }
    if (tab === 3) {
      lines.push('', 'Installed extensions · current workspace');
      for (const extension of data.extensions) lines.push(`${clean(extension.name)} · ${extension.enabled ? 'enabled' : 'disabled'} · ${extension.scope} · ${extension.skills} skills / ${extension.tools} tools`);
      if (!data.extensions.length) lines.push('No extensions installed.');
    }
  }

  return lines;
}

export function UsageScreen({ account, autohandCloud = false, loadReport, loadAccount, loadTraces, onClose, initialDays = 7, rows, columns }: UsageScreenProps) {
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
  const [activityDate, setActivityDate] = useState<string>();
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
    if (!autohandCloud) return;
    const controller = new AbortController();
    setAccountData(undefined);
    void loadAccount(controller.signal).then(result => { if (!controller.signal.aborted) setAccountData(result); })
      .catch(() => { if (!controller.signal.aborted) setAccountData(null); });
    return () => controller.abort();
  }, [autohandCloud, loadAccount, refresh]);
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
  const lines: ReportRow[] = [];
  if (help) {
    lines.push('Keyboard controls', '', 'Tab / Shift+Tab or 1–7  Switch report', '← / →  Select day in a chart', '↑ / ↓ and PgUp / PgDn  Browse rows', 'Enter  Session details',
      'Click  Open a report tab, select a chart or activity day, select then open a session', 'Wheel  Scroll', 's  Sort sessions by tokens or recent activity', 'r  Toggle 7 / 30 days', 'p  Toggle this project / all local projects', 'R  Refresh data', 'Esc  Back / close', 'Ctrl+C  Close report', '', 'Sources', 'Account plan and quota: Autohand API.', 'Tokens/messages: local session metadata, all message roles.', 'Charts group entire session totals by last active UTC day.', 'Skills/extensions: recorded project capability events.', 'Traces: optional local ahtraces Work Map; never added to session totals.', 'Missing token usage remains unavailable; it is not estimated.');
  } else if (loading) lines.push('Loading local activity…');
  else if (error) lines.push('Unable to load local activity. Press R to retry.');
  else if (data) {
    const view: ReportView = { tab, data, report, heatmap, sessions, accountData, trace, traceError, detail, row, sortTokens, days, selectedDay, activityDate, activeDay, width, bodyHeight, accent, muted, autohandCloud };
    lines.push(...(tab === 0 ? overviewLines(view) : tab === 5 ? sessionLines(view) : tab === 6 ? traceLines(view) : activityLines(view)));
  }
  const wrapped = lines.flatMap((line): ReportLine[] => {
    const { text, click } = typeof line === 'string' ? { text: line, click: undefined } : line;
    return wrapAnsi(text, width, { hard: true, trim: false }).split('\n').map(part => ({ text: part, click }));
  });
  const offset = tab === 5 && !detail && !help ? Math.max(0, Math.min(wrapped.length - bodyHeight, row - bodyHeight + 4)) : Math.min(row, Math.max(0, wrapped.length - bodyHeight));
  const visible = wrapped.slice(offset, offset + bodyHeight);
  const openTab = (next: number) => { setTab(next); setRow(0); setDetail(undefined); setHelp(false); };
  const scroll = (delta: number) => {
    const max = tab === 5 && !detail && !help ? Math.max(0, sessions.length - 1) : Math.max(0, wrapped.length - bodyHeight);
    setRow(value => Math.max(0, Math.min(max, value + delta)));
  };
  /** The screen starts at the terminal's first row, so a report cell is addressed by its own layout; anything that is not a target stays inert. */
  const handleMouse = (mouse: SgrMouseInput) => {
    if (mouse.action === 'wheel') { scroll(mouse.button === 'wheel-up' ? -WHEEL_ROWS : WHEEL_ROWS); return; }
    if (mouse.action !== 'press' || mouse.button !== 'left') return;
    const column = mouse.column - 1;
    const line = mouse.row - 1;
    const tabIndex = line === TAB_ROW ? tabAt(column, width) : undefined;
    const click: UsageClick | undefined = tabIndex !== undefined ? { kind: 'tab', tab: tabIndex } : visible[line - BODY_ROW]?.click?.(column);
    if (!click) return;
    if (click.kind === 'tab') openTab(click.tab);
    else if (click.kind === 'day') setSelectedDay(click.day);
    else if (click.kind === 'activity') setActivityDate(value => value === click.date ? undefined : click.date);
    else if (click.row === row) { setDetail(sessions[click.row]); setRow(0); } else setRow(click.row);
  };
  useInput((input, key) => {
    const mouse = parseSgrMouseInput(input);
    if (mouse) { handleMouse(mouse); return; }
    if (key.ctrl && input === 'c') { onClose(); return; }
    if (key.escape || input === 'q') {
      if (help) { setHelp(false); setRow(0); } else if (detail) { setRow(Math.max(0, sessions.findIndex(session => session.sessionId === detail.sessionId))); setDetail(undefined); } else onClose();
      return;
    }
    if (key.tab || /^[1-7]$/u.test(input)) { openTab(key.tab ? (tab + (key.shift ? 6 : 1)) % 7 : Number(input) - 1); return; }
    if (input === '?') { setHelp(value => !value); setRow(0); return; }
    if (input === 'r') { setDays(days === 7 ? 30 : 7); setSelectedDay(days === 7 ? 29 : 6); setRow(0); setDetail(undefined); return; }
    if (input === 'p') { setScope(scope === 'project' ? 'all' : 'project'); setRow(0); setDetail(undefined); return; }
    if (input === 'R') { setRefresh(value => value + 1); setRow(0); setDetail(undefined); return; }
    if (input === 's' && tab === 5) { setSortTokens(value => !value); setRow(0); setDetail(undefined); return; }
    if (key.return && tab === 5 && !detail && !help && sessions.length) { setDetail(sessions[row]); setRow(0); return; }
    if (key.leftArrow || key.rightArrow) { setSelectedDay(value => Math.max(0, Math.min(days - 1, value + (key.leftArrow ? -1 : 1)))); setRow(0); return; }
    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) scroll((key.upArrow || key.pageUp ? -1 : 1) * (key.pageUp || key.pageDown ? bodyHeight : 1));
  });
  return <Box flexDirection="column" width={width} height={Math.max(8, height - 1)}>
    <Text bold wrap="truncate">Usage · {clean([accountData?.limits?.displayName ?? accountData?.tier, account].filter(Boolean).join(' · '))}</Text>
    <Text wrap="truncate">{tabLabels(width).map((label, index) => index === tab ? accent.bold(label) : muted(label)).join(TAB_GAP)}</Text>
    <Text color={colors.muted} wrap="truncate">{`r ${days}d · p ${scope === 'project' ? 'This project' : 'All local projects'} · ${TABS[tab]}${help ? ' help' : ''}`}</Text>
    <Text> </Text>
    {Array.from({ length: bodyHeight }, (_, index) => <Text key={index} wrap="truncate">{visible[index]?.text || ' '}</Text>)}
    <Text color={colors.muted} wrap="truncate">{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()} · ${data.sessions.length}/${data.totalSessions} loaded${data.warnings.length ? ' · partial data' : ''} · ${offset + 1}–${Math.min(offset + bodyHeight, wrapped.length)}/${wrapped.length}` : 'Local activity and account quota'}</Text>
    <Text color={colors.muted} wrap="truncate">Tab/1–7 report · ←→ day · ↑↓ scroll · Enter details</Text>
    <Text color={colors.muted} wrap="truncate">r range · p scope · R refresh · ? help · Esc back</Text>
  </Box>;
}

export async function showUsageScreen({ mouse = false, ...props }: ShowUsageScreenOptions): Promise<void> {
  prepareModalRender();
  if (mouse) process.stdout.write(ENABLE_SGR_MOUSE_TRACKING);
  try {
    const instance = render(<ThemeProvider><UsageScreen {...props} onClose={() => instance.unmount()} /></ThemeProvider>, { exitOnCtrlC: false });
    await instance.waitUntilExit();
  } finally {
    if (mouse) process.stdout.write(DISABLE_SGR_MOUSE_TRACKING);
    cleanupModalRender();
  }
}
