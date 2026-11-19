/** @license Apache-2.0 */
import type { Key } from 'ink';
import { isComputerUseStep } from '../../computer/computerUseOutput.js';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import type { ChatLogMessage } from '../../session/chatLog.js';
import { formatAssistantMarkdown } from '../terminalMarkdown.js';

export interface FullScreenMessage extends ChatLogMessage {
  detailsId?: string;
}

export interface TranscriptRow {
  text: string;
  role?: ChatLogMessage['role'];
}

interface FormattedMessage {
  lines: string[];
  searchText: string;
  rowEnds: number[];
}

interface Entry extends FormattedMessage {
  message: FullScreenMessage;
  end: number;
}

interface SearchMatch {
  index: number;
  row: number;
}

/** The footer's status, tip and completion rows come and go one or two at a time. */
const FOOTER_FLICKER_ROWS = 2;

/** A transcript cell: absolute wrapped-line index and terminal column. */
interface SelectionPoint {
  line: number;
  column: number;
}

/** Characters whose first terminal cell falls in [from, to). */
function sliceCells(text: string, from: number, to: number): string {
  let column = 0;
  let result = '';
  for (const character of text) {
    if (column >= to) break;
    if (column >= from) result += character;
    column += stringWidth(character);
  }
  return result;
}

export interface TranscriptView {
  lines: string[];
  rows: TranscriptRow[];
  following: boolean;
  newActivity: boolean;
  start: number;
  total: number;
}

function formatMessage(message: ChatLogMessage, width: number): string[] {
  let text = message.content;
  if (message.role === 'tool' && message.tool === 'computer_use') {
    try {
      const steps: unknown = JSON.parse(text);
      if (Array.isArray(steps) && steps.every(isComputerUseStep)) text = steps.map(step => `${step.status === 'done' ? '✓' : step.status === 'failed' ? '×' : '?'} ${step.label}${step.detail ? ` · ${step.detail}` : ''}`).join('\n');
    } catch { /* Keep the original tool error if it is not structured progress. */ }
  }
  if (message.role === 'assistant' && message.renderMarkdown !== false) text = formatAssistantMarkdown(text, { width });
  else if (message.role === 'user') text = `❯ ${text}`;
  else if (message.role === 'tool') text = `${message.interrupted ? '⊘' : message.success === false ? '×' : '✓'} ${message.tool ?? 'Tool'}\n${text}`;
  else if (message.role === 'tool_call') text = `… ${message.tool ?? 'Tool'} ${text}`;
  else if (message.role === 'tool_batch') text = (message.groups ?? []).flatMap(group => group.items.map(item => `${item.success ? '✓' : '×'} ${item.label}${item.detail ? ` · ${item.detail}` : ''}`)).join('\n');
  else if (message.role === 'thinking') text = `Thinking · ${text}`;
  const lines = [...wrapAnsi(text, width, { hard: true, trim: false }).split('\n'), ''];
  return message.role === 'user' ? ['', ...lines] : lines;
}

export class FullScreenTranscript {
  searchQuery: string | null = null;
  searchMatched = true;
  private entries: Entry[] = [];
  private cache = new WeakMap<ChatLogMessage, FormattedMessage>();
  private width = 0;
  private offset = 0;
  private following = true;
  private newActivity = false;
  private lastQuery = '';
  private lastMatch = -1;
  private height = 1;
  private detailsId: string | undefined;
  private viewStart = 0;
  /**
   * Blank rows kept below the transcript while it follows the tail. A running turn swaps
   * transient rows for final ones (a streamed preview for its tool call, a live command block for
   * its result, the status row for the completion row) and removes them a frame before it adds
   * the replacement. A tail that tracked the shorter transcript dragged history down and back up.
   * Instead the vacated rows stay blank, and new output or a taller footer uses them up first.
   */
  private tailGap = 0;
  private tailTotal = 0;
  private tailHeight = Number.POSITIVE_INFINITY;
  private selection: { anchor: SelectionPoint; focus: SelectionPoint } | null = null;
  /** Set after a drag copied text; the frame shows it until the next selection. */
  copiedSelection = false;

  focusDetails(id: string | undefined): void {
    if (id === this.detailsId) return;
    this.detailsId = id;
    if (!id) {
      this.follow();
      return;
    }
    this.following = false;
    // A finished result and its open details share an id; the details are the later entry.
    let index = this.entries.length - 1;
    while (index >= 0 && this.entries[index].message.detailsId !== id) index--;
    this.offset = index >= 0
      ? (this.entries[index - 1]?.end ?? 0)
      : (this.entries.at(-2)?.end ?? 0);
  }

  invalidate(): void {
    this.width = 0;
  }

  handleKey(input: string, key: Pick<Key, 'ctrl' | 'escape' | 'return' | 'backspace' | 'delete' | 'pageUp' | 'pageDown' | 'meta' | 'end' | 'home' | 'shift'>): boolean {
    if (key.ctrl && input === 'f') {
      this.searchQuery = '';
      this.searchMatched = true;
      return true;
    }
    if (this.searchQuery !== null) {
      if (key.escape || (key.ctrl && input === 'c')) this.searchQuery = null;
      else if (key.return) this.searchMatched = this.search(this.searchQuery, this.height, key.shift ? -1 : 1);
      else if (key.backspace || key.delete) {
        this.searchQuery = Array.from(this.searchQuery).slice(0, -1).join('');
        this.refreshSearch(true);
      } else if (!key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/u.test(input)) {
        this.searchQuery = (this.searchQuery + input).slice(0, 128);
        this.refreshSearch(true);
      }
      return true;
    }
    if (key.ctrl && key.home) {
      this.following = false;
      this.offset = 0;
      return true;
    }
    if (key.escape && !this.following && !this.detailsId) {
      this.follow();
      return true;
    }
    if (key.pageUp || key.pageDown) {
      this.page(key.pageUp ? -1 : 1);
      return true;
    }
    if ((key.ctrl && key.end) || input === '\x1b[1;5F' || input === '\x1b[4;5~') {
      this.follow();
      return true;
    }
    return false;
  }

  update(messages: readonly FullScreenMessage[], width: number): void {
    width = Math.max(1, width);
    const oldIndex = this.entries.findIndex(entry => entry.end > this.offset);
    const previousEnd = oldIndex > 0 ? this.entries[oldIndex - 1].end : 0;
    const oldEntry = this.entries[oldIndex];
    const characters = oldEntry?.lines.slice(0, this.offset - previousEnd).reduce((sum, line) => sum + stripAnsi(line).length, 0) ?? 0;
    const previousLast = this.entries.at(-1)?.message;
    const nextLast = messages.at(-1);
    if (!this.following && (messages.length > this.entries.length ||
      (previousLast && nextLast && previousLast.content !== nextLast.content))) this.newActivity = true;
    const first = this.entries[0]?.message;
    if (first && (!messages[0] || first.role !== messages[0].role || !messages[0].content.startsWith(first.content))) this.follow();
    if (width !== this.width) {
      this.cache = new WeakMap();
      this.width = width;
      this.resetTail();
    }
    let end = 0;
    this.entries = messages.map(message => {
      let formatted = this.cache.get(message);
      if (!formatted) {
        const lines = formatMessage(message, width);
        const plainLines = lines.map(line => stripAnsi(line).toLocaleLowerCase());
        let rowEnd = 0;
        formatted = { lines, searchText: plainLines.join('\n'), rowEnds: plainLines.map(line => rowEnd += line.length + 1) };
        this.cache.set(message, formatted);
      }
      end += formatted.lines.length;
      return { message, ...formatted, end };
    });
    if (!this.following && oldIndex >= 0 && this.entries[oldIndex]) {
      let row = 0;
      let consumed = 0;
      const entry = this.entries[oldIndex];
      while (row < entry.lines.length - 1 && consumed < characters) consumed += stripAnsi(entry.lines[row++]).length;
      this.offset = (oldIndex > 0 ? this.entries[oldIndex - 1].end : 0) + row;
    }
    this.refreshSearch();
  }

  private refreshSearch(reset = false): void {
    if (this.searchQuery === null) return;
    if (reset) this.lastMatch = -1;
    this.searchMatched = !this.searchQuery.trim() || this.search(this.searchQuery, this.height, 1, false);
  }

  view(height: number): TranscriptView {
    this.height = Math.max(1, height);
    const total = this.entries.at(-1)?.end ?? 0;
    const gap = this.following ? this.settleTailGap(total) : 0;
    this.tailGap = gap;
    this.tailTotal = total;
    this.tailHeight = this.height;
    const start = this.following
      ? Math.max(0, total + gap - this.height)
      : Math.min(this.offset, Math.max(0, total - this.height));
    this.offset = start;
    this.viewStart = start;
    const rows: TranscriptRow[] = [];
    for (let index = this.entryIndexAt(start); index < this.entries.length && rows.length < this.height; index++) {
      const entry = this.entries[index];
      const before = index > 0 ? this.entries[index - 1].end : 0;
      const from = Math.max(0, start - before);
      rows.push(...entry.lines.slice(from, from + this.height - rows.length).map(text => ({ text, role: entry.message.role })));
    }
    return { lines: rows.map(row => row.text), rows, following: this.following, newActivity: this.newActivity, start, total };
  }

  /** Rows removed since the last view stay blank; rows added, or taken by the footer, fill them. */
  private settleTailGap(total: number): number {
    const grown = this.height - this.tailHeight;
    // A menu closing hands back many rows and the transcript follows the composer down; a status
    // row flickering away hands back one or two, and following it would move everything twice.
    const heightChange = grown > FOOTER_FLICKER_ROWS ? 0 : grown;
    const gap = this.tailGap + (this.tailTotal - total) + heightChange;
    // Transient rows are a few lines; a larger removal is a real change and moves the view.
    return Math.max(0, Math.min(gap, Math.floor(this.height / 2)));
  }

  /** Drop any held rows: the next view starts from the true tail (a provisional layout, a resize). */
  settleTail(): void {
    this.resetTail();
  }

  private resetTail(): void {
    this.tailGap = 0;
    this.tailTotal = 0;
    this.tailHeight = Number.POSITIVE_INFINITY;
  }

  isBodyRow(viewRow: number): boolean {
    return viewRow >= 0 && viewRow < this.height;
  }

  /** Start a drag at a body-relative row and column of the last rendered view. */
  beginSelection(viewRow: number, column: number): void {
    const point = this.pointAt(viewRow, column);
    this.selection = { anchor: point, focus: point };
    this.copiedSelection = false;
  }

  extendSelection(viewRow: number, column: number): void {
    if (this.selection) this.selection.focus = this.pointAt(viewRow, column);
  }

  /** Finish the drag. Returns the selected plain text, or null when the pointer never moved (a click). */
  endSelection(): string | null {
    const range = this.selectionRange();
    if (!range) {
      this.selection = null;
      return null;
    }
    const [start, end] = range;
    const lines: string[] = [];
    for (let line = start.line; line <= end.line; line++) {
      const from = line === start.line ? start.column : 0;
      const to = line === end.line ? end.column + 1 : Infinity;
      lines.push(sliceCells(this.plainLine(line), from, to).trimEnd());
    }
    const text = lines.join('\n').replace(/\n+$/u, '');
    this.copiedSelection = text.length > 0;
    return text || null;
  }

  clearSelection(): void {
    this.selection = null;
    this.copiedSelection = false;
  }

  /** Highlighted [from, to) columns for a body row of the last rendered view. */
  selectionColumns(viewRow: number): [number, number] | null {
    const range = this.selectionRange();
    const line = this.viewStart + viewRow;
    if (!range || line < range[0].line || line > range[1].line) return null;
    return [line === range[0].line ? range[0].column : 0, line === range[1].line ? range[1].column + 1 : Infinity];
  }

  /** The details id when a body row belongs to an expandable entry (a command block or open details). */
  detailsAt(viewRow: number): string | undefined {
    if (viewRow < 0 || viewRow >= this.height) return undefined;
    const located = this.locate(this.viewStart + viewRow);
    return located?.text ? located.entry.message.detailsId : undefined;
  }

  private pointAt(viewRow: number, column: number): SelectionPoint {
    const total = this.entries.at(-1)?.end ?? 0;
    const row = Math.max(0, Math.min(this.height - 1, viewRow));
    return { line: Math.max(0, Math.min(total - 1, this.viewStart + row)), column: Math.max(0, column) };
  }

  private selectionRange(): [SelectionPoint, SelectionPoint] | null {
    if (!this.selection) return null;
    const { anchor, focus } = this.selection;
    if (anchor.line === focus.line && anchor.column === focus.column) return null;
    return anchor.line < focus.line || (anchor.line === focus.line && anchor.column < focus.column)
      ? [anchor, focus]
      : [focus, anchor];
  }

  /** Index of the entry containing an absolute wrapped line (entries.length when past the end). */
  private entryIndexAt(line: number): number {
    let low = 0;
    let high = this.entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.entries[mid].end <= line) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private locate(line: number): { entry: Entry; text: string } | undefined {
    const index = this.entryIndexAt(line);
    const entry = this.entries[index];
    if (!entry || line < 0) return undefined;
    const before = index > 0 ? this.entries[index - 1].end : 0;
    return { entry, text: entry.lines[line - before] ?? '' };
  }

  private plainLine(line: number): string {
    return stripAnsi(this.locate(line)?.text ?? '');
  }

  scroll(delta: number, height = this.height): void {
    const view = this.view(height);
    const max = Math.max(0, view.total - height);
    this.offset = Math.max(0, Math.min(max, view.start + delta));
    // A held tail starts below the true tail; scrolling up from it must leave follow mode.
    this.following = this.offset === max && this.offset >= view.start;
    if (this.following) this.newActivity = false;
  }

  page(direction: -1 | 1): void {
    this.scroll(direction * Math.max(1, this.height - 1));
  }

  follow(): void {
    this.following = true;
    this.resetTail();
    this.newActivity = false;
    this.lastMatch = -1;
  }

  search(query: string, height = this.height, direction: -1 | 1 = 1, advance = true): boolean {
    if (!query.trim()) return false;
    const needle = query.trim().toLocaleLowerCase();
    const pattern = new RegExp(needle.split(/\s+/u).map(word => Array.from(word, character =>
      character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    ).join('\n?')).join('\\s+'), 'gu');
    const after = needle === this.lastQuery ? this.lastMatch : -1;
    let first: SearchMatch | undefined;
    let next: SearchMatch | undefined;
    let last: SearchMatch | undefined;
    let index = 0;
    let row = 0;
    for (const entry of this.entries) {
      let localRow = 0;
      for (const result of entry.searchText.matchAll(pattern)) {
        while (entry.rowEnds[localRow] <= result.index) localRow++;
        const match = { index: index++, row: row + localRow };
        first ??= match;
        last = match;
        if (direction === 1 ? (advance ? match.index > after : match.index >= after) && !next : match.index < after) next = match;
      }
      row += entry.lines.length;
    }
    const match = next ?? (direction === 1 ? first : last);
    this.lastQuery = needle;
    this.lastMatch = match?.index ?? -1;
    if (!match) return false;
    this.following = false;
    this.offset = Math.min(match.row, Math.max(0, row - height));
    return true;
  }
}
