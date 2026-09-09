import { spawn, type IPty } from 'node-pty';
import { stripVTControlCharacters } from 'node:util';

export class PtyDriver {
  private terminal?: IPty;
  private output = '';

  launch(command: string, args: string[], options: { cwd?: string; cols?: number; rows?: number } = {}): void {
    this.terminal = spawn(command, args, {
      name: 'xterm-256color', cwd: options.cwd ?? process.cwd(),
      cols: options.cols ?? 120, rows: options.rows ?? 32,
      env: { ...process.env, CI: 'false', FORCE_COLOR: '0', TERM: 'xterm-256color' },
    });
    this.terminal.onData(data => { this.output += data; });
  }

  type(text: string): void { this.terminal?.write(text); }
  enter(): void { this.type('\r'); }
  up(): void { this.type('\x1b[A'); }
  down(): void { this.type('\x1b[B'); }
  ctrlC(): void { this.type('\x03'); }
  snapshot(): string { return stripVTControlCharacters(this.output); }
  close(): void { this.terminal?.kill(); }

  async waitFor(expected: string | RegExp, timeout = 10_000, after = 0): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const output = this.snapshot().slice(after);
      if (typeof expected === 'string' ? output.includes(expected) : expected.test(output)) return;
      await new Promise<void>(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`Terminal did not display ${String(expected)}:\n${this.snapshot()}`);
  }
}
