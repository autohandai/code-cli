/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export interface ReadTextWindowOptions {
  offset: number;
  lineLimit: number;
  maxBytes: number;
  maxLineCharacters: number;
}

export interface ReadTextWindowLine {
  lineNumber: number;
  content: string;
  clamped: boolean;
}

export type ReadTextWindowContinuation =
  | { kind: 'bytes'; offset: number; sourceLineNumber: number }
  | { kind: 'lines'; offset: number };

export interface ReadTextWindowResult {
  lines: ReadTextWindowLine[];
  continuation?: ReadTextWindowContinuation;
  reachedEof: boolean;
  linesScanned: number;
}

class TextWindowCollector {
  readonly lines: ReadTextWindowLine[] = [];
  continuation: ReadTextWindowContinuation | undefined;
  reachedEof = false;
  stopped = false;

  private currentLineIndex = 0;
  private currentLineContent = '';
  private currentLineCharacters = 0;
  private currentLineClamped = false;
  private currentLineHasData = false;
  private currentLineStarted = false;
  private pendingCarriageReturn = false;
  private outputBytes = 0;
  private firstCodePoint = true;

  constructor(private readonly options: ReadTextWindowOptions) {}

  consume(text: string): void {
    for (const character of text) {
      if (this.stopped) {
        return;
      }
      if (this.firstCodePoint) {
        this.firstCodePoint = false;
        if (character === '\uFEFF') {
          continue;
        }
      }

      if (character === '\n') {
        this.consumeNewline();
        continue;
      }

      if (this.isBeyondRequestedWindow()) {
        this.stopForLineLimit();
        return;
      }

      this.currentLineHasData = true;
      if (this.currentLineIndex < this.options.offset) {
        continue;
      }
      if (character === '\r') {
        if (this.pendingCarriageReturn) {
          this.appendCharacter('\r');
        }
        this.pendingCarriageReturn = true;
        continue;
      }
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        this.appendCharacter('\r');
        if (this.stopped) {
          return;
        }
      }
      this.appendCharacter(character);
    }
  }

  finish(): ReadTextWindowResult {
    if (!this.stopped) {
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        this.appendCharacter('\r');
      }
      if (!this.stopped && this.currentLineHasData) {
        this.finishCurrentLine();
      }
      if (!this.stopped) {
        this.reachedEof = true;
      }
    }

    return {
      lines: this.lines,
      ...(this.continuation === undefined ? {} : { continuation: this.continuation }),
      reachedEof: this.reachedEof,
      linesScanned: this.currentLineIndex,
    };
  }

  private consumeNewline(): void {
    if (this.isBeyondRequestedWindow()) {
      this.stopForLineLimit();
      return;
    }
    this.pendingCarriageReturn = false;
    this.finishCurrentLine();
  }

  private finishCurrentLine(): void {
    if (this.currentLineIndex >= this.options.offset) {
      if (!this.ensureCurrentLineStarted()) {
        return;
      }
      this.lines.push({
        lineNumber: this.currentLineIndex + 1,
        content: this.currentLineContent,
        clamped: this.currentLineClamped,
      });
    }
    this.currentLineIndex++;
    this.currentLineContent = '';
    this.currentLineCharacters = 0;
    this.currentLineClamped = false;
    this.currentLineHasData = false;
    this.currentLineStarted = false;
  }

  private appendCharacter(character: string): void {
    if (this.currentLineCharacters >= this.options.maxLineCharacters) {
      this.currentLineClamped = true;
      return;
    }
    this.currentLineCharacters++;
    if (!this.ensureCurrentLineStarted()) {
      return;
    }
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (this.outputBytes + characterBytes > this.options.maxBytes) {
      this.stopForByteLimit();
      return;
    }
    this.currentLineContent += character;
    this.outputBytes += characterBytes;
  }

  private ensureCurrentLineStarted(): boolean {
    if (this.currentLineStarted) {
      return true;
    }
    const separator = this.lines.length > 0 ? '\n' : '';
    const prefix = `${separator}${String(this.currentLineIndex + 1).padStart(6)}\t`;
    const prefixBytes = Buffer.byteLength(prefix, 'utf8');
    if (this.outputBytes + prefixBytes > this.options.maxBytes) {
      this.stopForByteLimit();
      return false;
    }
    this.outputBytes += prefixBytes;
    this.currentLineStarted = true;
    return true;
  }

  private isBeyondRequestedWindow(): boolean {
    return this.currentLineIndex >= this.options.offset + this.options.lineLimit;
  }

  private stopForLineLimit(): void {
    this.continuation = {
      kind: 'lines',
      offset: this.currentLineIndex,
    };
    this.stopped = true;
  }

  private stopForByteLimit(): void {
    if (this.currentLineStarted) {
      this.lines.push({
        lineNumber: this.currentLineIndex + 1,
        content: this.currentLineContent,
        clamped: this.currentLineClamped,
      });
    }
    this.continuation = {
      kind: 'bytes',
      offset: this.currentLineIndex,
      sourceLineNumber: this.currentLineIndex + 1,
    };
    this.stopped = true;
  }
}

export async function readTextFileWindow(
  filePath: string,
  options: ReadTextWindowOptions,
): Promise<ReadTextWindowResult> {
  const collector = new TextWindowCollector(options);
  const decoder = new StringDecoder('utf8');
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });

  for await (const chunk of stream) {
    collector.consume(decoder.write(chunk as Buffer));
    if (collector.stopped) {
      break;
    }
  }
  if (!collector.stopped) {
    collector.consume(decoder.end());
  }
  return collector.finish();
}
