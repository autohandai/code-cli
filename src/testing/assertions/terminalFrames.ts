/** @license Apache-2.0 */
import { PersistentTerminal } from 'ghostty-opentui';
import { readFile } from 'node:fs/promises';

export interface TerminalWriteRecord {
  columns: number;
  rows: number;
  terminal: string;
  output: string;
}

export async function readTerminalWriteTrace(file: string): Promise<TerminalWriteRecord[]> {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => {
    const record: unknown = JSON.parse(line);
    if (!record || typeof record !== 'object' || !('columns' in record) || typeof record.columns !== 'number'
      || !('rows' in record) || typeof record.rows !== 'number' || !('output' in record) || typeof record.output !== 'string'
      || !('terminal' in record) || typeof record.terminal !== 'string') throw new Error('Invalid terminal write trace');
    return { columns: record.columns, rows: record.rows, terminal: record.terminal, output: record.output };
  });
}

export interface PublishedTerminalFrame {
  columns: number;
  rows: number;
  sourceColumns: number;
  sourceRows: number;
  text: string;
}

export class TerminalFrameRecorder {
  readonly frames: PublishedTerminalFrame[] = [];
  private readonly terminal: PersistentTerminal;
  private pending = '';
  private sourceViewport: { columns: number; rows: number };

  constructor(columns: number, rows: number, initialOutput: string) {
    this.terminal = new PersistentTerminal({ cols: columns, rows });
    this.sourceViewport = { columns, rows };
    this.rememberSourceViewport(initialOutput);
    this.terminal.feed(initialOutput);
  }

  feed(data: string): void {
    this.pending += data;
    const end = '\x1b[?2026l';
    let boundary = this.pending.indexOf(end);
    while (boundary !== -1) {
      const frame = this.pending.slice(0, boundary + end.length);
      this.rememberSourceViewport(frame);
      this.terminal.feed(frame);
      this.pending = this.pending.slice(boundary + end.length);
      this.frames.push(this.snapshot());
      boundary = this.pending.indexOf(end);
    }
  }

  feedWrite(record: TerminalWriteRecord): void {
    if (record.columns !== this.terminal.cols || record.rows !== this.terminal.rows) {
      this.resize(record.columns, record.rows);
    }
    this.sourceViewport = { columns: record.columns, rows: record.rows };
    this.terminal.feed(record.output.replaceAll('\n', '\r\n'));
    this.frames.push(this.snapshot());
  }

  resize(columns: number, rows: number): void {
    if (this.pending) {
      this.rememberSourceViewport(this.pending);
      this.terminal.feed(this.pending);
      this.pending = '';
    }
    this.terminal.resize(columns, rows);
  }

  close(): void {
    this.terminal.destroy();
  }

  private rememberSourceViewport(output: string): void {
    for (const match of output.matchAll(/\x1b\]777;resize-fixture;(\d+);(\d+)\x07/g)) {
      this.sourceViewport = { columns: Number(match[1]), rows: Number(match[2]) };
    }
  }

  private snapshot(): PublishedTerminalFrame {
    return { columns: this.terminal.cols, rows: this.terminal.rows, sourceColumns: this.sourceViewport.columns,
      sourceRows: this.sourceViewport.rows, text: this.terminal.getText() };
  }
}
