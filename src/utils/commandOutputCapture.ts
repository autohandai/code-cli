export const MAX_COMMAND_OUTPUT_CHARACTERS = 1024 * 1024;

export class CommandOutputCapture {
  private head = '';
  private tail = '';
  private totalLength = 0;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  constructor(private readonly limit = MAX_COMMAND_OUTPUT_CHARACTERS) {
    if (!Number.isInteger(limit) || limit < 2) {
      throw new RangeError('Command output capture limit must be an integer of at least 2');
    }
    this.headLimit = Math.floor(limit / 2);
    this.tailLimit = limit - this.headLimit;
  }

  get length(): number {
    return this.totalLength;
  }

  append(chunk: string): void {
    this.totalLength += chunk.length;
    const headLength = Math.min(chunk.length, this.headLimit - this.head.length);
    this.head += chunk.slice(0, headLength);
    const remaining = chunk.slice(headLength);
    this.tail = (this.tail + remaining.slice(-this.tailLimit)).slice(-this.tailLimit);
  }

  toString(): string {
    if (this.totalLength <= this.limit) {
      return this.head + this.tail;
    }
    const head = /[\uD800-\uDBFF]$/.test(this.head) ? this.head.slice(0, -1) : this.head;
    const tail = /^[\uDC00-\uDFFF]/.test(this.tail) ? this.tail.slice(1) : this.tail;
    return `${head}\n[output truncated: ${this.totalLength - head.length - tail.length} characters omitted]\n${tail}`;
  }
}

export class CommandOutputLineBuffer {
  private pending = new CommandOutputCapture();

  push(chunk: string, writeLine: (line: string) => void): void {
    let start = 0;
    for (const boundary of chunk.matchAll(/\r\n|\r|\n/g)) {
      this.pending.append(chunk.slice(start, boundary.index));
      writeLine(this.pending.toString());
      this.pending = new CommandOutputCapture();
      start = boundary.index + boundary[0].length;
    }
    this.pending.append(chunk.slice(start));
  }

  flush(writeLine: (line: string) => void): void {
    if (this.pending.length === 0) return;
    writeLine(this.pending.toString());
    this.pending = new CommandOutputCapture();
  }
}
