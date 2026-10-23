/** @license Apache-2.0 */
import type { Key } from 'ink';
import { isComputerUseStep } from '../../computer/computerUseOutput.js';
import stripAnsi from 'strip-ansi';
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

interface Entry {
  message: FullScreenMessage;
  lines: string[];
  end: number;
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
  else if (message.role === 'tool') text = `${message.success === false ? '×' : '✓'} ${message.tool ?? 'Tool'}\n${text}`;
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
  private cache = new WeakMap<ChatLogMessage, string[]>();
  private width = 0;
  private offset = 0;
  private following = true;
  private newActivity = false;
  private lastQuery = '';
  private lastMatch = -1;
  private height = 1;
  private detailsId: string | undefined;

  focusDetails(id: string | undefined): void {
    if (id === this.detailsId) return;
    this.detailsId = id;
    if (!id) {
      this.follow();
      return;
    }
    this.following = false;
    const index = this.entries.findIndex(entry => entry.message.detailsId === id);
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
      else if (key.backspace || key.delete) this.searchQuery = Array.from(this.searchQuery).slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/u.test(input)) this.searchQuery = (this.searchQuery + input).slice(0, 128);
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
    if (first && (!messages[0] || first.role !== messages[0].role || first.content !== messages[0].content)) this.follow();
    if (width !== this.width) {
      this.cache = new WeakMap();
      this.width = width;
    }
    let end = 0;
    this.entries = messages.map(message => {
      let lines = this.cache.get(message);
      if (!lines) {
        lines = formatMessage(message, width);
        this.cache.set(message, lines);
      }
      end += lines.length;
      return { message, lines, end };
    });
    if (!this.following && oldIndex >= 0 && this.entries[oldIndex]) {
      let row = 0;
      let consumed = 0;
      const entry = this.entries[oldIndex];
      while (row < entry.lines.length - 1 && consumed < characters) consumed += stripAnsi(entry.lines[row++]).length;
      this.offset = (oldIndex > 0 ? this.entries[oldIndex - 1].end : 0) + row;
    }
  }

  view(height: number): TranscriptView {
    this.height = Math.max(1, height);
    const total = this.entries.at(-1)?.end ?? 0;
    const start = this.following ? Math.max(0, total - this.height) : Math.min(this.offset, Math.max(0, total - this.height));
    this.offset = start;
    const rows: TranscriptRow[] = [];
    let low = 0;
    let high = this.entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.entries[mid].end <= start) low = mid + 1;
      else high = mid;
    }
    for (let index = low; index < this.entries.length && rows.length < this.height; index++) {
      const entry = this.entries[index];
      const before = index > 0 ? this.entries[index - 1].end : 0;
      const from = Math.max(0, start - before);
      rows.push(...entry.lines.slice(from, from + this.height - rows.length).map(text => ({ text, role: entry.message.role })));
    }
    return { lines: rows.map(row => row.text), rows, following: this.following, newActivity: this.newActivity, start, total };
  }

  scroll(delta: number, height = this.height): void {
    const view = this.view(height);
    const max = Math.max(0, view.total - height);
    this.offset = Math.max(0, Math.min(max, view.start + delta));
    this.following = this.offset === max;
    if (this.following) this.newActivity = false;
  }

  page(direction: -1 | 1): void {
    this.scroll(direction * Math.max(1, this.height - 1));
  }

  follow(): void {
    this.following = true;
    this.newActivity = false;
    this.lastMatch = -1;
  }

  search(query: string, height = this.height, direction: -1 | 1 = 1): boolean {
    if (!query.trim()) return false;
    const needle = query.toLocaleLowerCase();
    const after = needle === this.lastQuery ? this.lastMatch : -1;
    let first = -1;
    let next = -1;
    let last = -1;
    let row = 0;
    for (const entry of this.entries) for (const line of entry.lines) {
      if (stripAnsi(line).toLocaleLowerCase().includes(needle)) {
        if (first < 0) first = row;
        last = row;
        if (direction === 1 ? row > after && next < 0 : row < after) next = row;
      }
      row++;
    }
    const match = next >= 0 ? next : direction === 1 ? first : last;
    this.lastQuery = needle;
    this.lastMatch = match;
    if (match < 0) return false;
    this.following = false;
    this.offset = Math.min(match, Math.max(0, row - height));
    return true;
  }
}
