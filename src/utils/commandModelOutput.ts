import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CommandOutputCapture } from './commandOutputCapture.js';

export const DEFAULT_MAX_COMMAND_OUTPUT_CHARS = 30_000;

export function resolveMaxCommandOutputChars(configured?: number): number {
  const environment = Number(process.env.AUTOHAND_MAX_COMMAND_OUTPUT_CHARS);
  if (Number.isSafeInteger(environment) && environment >= 1024) return environment;
  return configured ?? DEFAULT_MAX_COMMAND_OUTPUT_CHARS;
}

/** Spools raw output without retaining it in memory; UI capture remains independent. */
export class CommandModelOutput {
  private pending = '';
  private totalLength = 0;
  private descriptor: number | undefined;
  private closed = false;
  private archiveFailed = false;
  private head = '';
  private tail = '';
  filePath: string | undefined;

  constructor(private readonly limit: number, private readonly sessionDirectory?: string) {
    if (!Number.isSafeInteger(limit) || limit < 1024) throw new RangeError('Command model output limit must be an integer of at least 1024');
  }

  append(chunk: string): void {
    if (this.closed) return;
    this.totalLength += chunk.length;
    this.head += chunk.slice(0, Math.max(0, this.limit - this.head.length));
    this.tail = (this.tail + chunk.slice(-this.limit)).slice(-this.limit);
    if (this.archiveFailed) return;
    if (this.totalLength <= this.limit) { this.pending += chunk; return; }
    if (!this.sessionDirectory) { this.pending = ''; return; }
    try {
      if (this.descriptor === undefined) {
        const directory = path.join(this.sessionDirectory, 'command-output');
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const filename = path.join(directory, `${randomUUID()}.log`);
        this.descriptor = openSync(filename, 'wx', 0o600);
        this.filePath = filename;
        this.write(this.pending);
        this.pending = '';
      }
      this.write(chunk);
    } catch {
      this.archiveFailed = true;
      this.filePath = undefined;
      this.pending = '';
      this.close();
    }
  }

  finish(observation: string): string {
    this.closed = true;
    this.close();
    if (this.totalLength <= this.limit && observation.length <= this.limit) return observation;
    const observationLimit = this.totalLength > this.limit
      ? Math.max(1024, Math.floor(this.limit / 2))
      : this.limit;
    let location = this.filePath
      ? `Full command output saved to ${this.filePath}. Use run_command with grep to inspect it.`
      : 'Full command output was not saved (session persistence disabled or archive unavailable).';
    let firstLine = observation.split('\n', 1)[0].slice(0, 512);
    if (/[\uD800-\uDBFF]$/.test(firstLine)) firstLine = firstLine.slice(0, -1);
    const prefix = firstLine + '\n';
    const marker = (omitted: number): string => `\n[output truncated: ${omitted} characters omitted. ${location}]\n`;
    if (this.filePath && prefix.length + marker(this.totalLength).length + 2 > observationLimit) {
      location = `Full command output saved as session artifact command-output/${path.basename(this.filePath)}.`;
    }
    if (this.totalLength > this.limit) {
      const room = Math.max(2, observationLimit - prefix.length - marker(this.totalLength).length);
      let head = this.head.slice(0, Math.floor(room / 2));
      let tail = this.tail.slice(-Math.ceil(room / 2));
      if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
      if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
      return prefix + head + marker(this.totalLength - head.length - tail.length) + tail;
    }
    const suffix = `\n[${location}]`;
    const capture = new CommandOutputCapture(Math.max(2, this.limit - suffix.length - 96));
    capture.append(observation);
    return capture.toString() + suffix;
  }

  private write(contents: string): void {
    const bytes = Buffer.from(contents);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(this.descriptor!, bytes, offset);
  }

  private close(): void {
    if (this.descriptor === undefined) return;
    const descriptor = this.descriptor;
    this.descriptor = undefined;
    try { closeSync(descriptor); } catch { this.filePath = undefined; }
  }
}
