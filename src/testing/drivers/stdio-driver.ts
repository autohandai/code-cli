import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { killAfter } from '../../utils/processTimeout.js';

export class StdioDriver {
  private child?: ChildProcessWithoutNullStreams;
  private output = '';
  private diagnostics = '';
  private completion?: Promise<number | null>;

  launch(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): void {
    const child = spawn(command, args, { ...options, stdio: 'pipe' });
    this.child = child;
    this.completion = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { this.output = (this.output + chunk).slice(-1_048_576); });
    child.stderr.on('data', (chunk: string) => { this.diagnostics = (this.diagnostics + chunk).slice(-65_536); });
    killAfter(child, 45_000, () => child.kill('SIGKILL'));
  }

  send(value: unknown): void { this.child?.stdin.write(`${JSON.stringify(value)}\n`); }
  end(): void { this.child?.stdin.end(); }
  close(): void { this.child?.kill('SIGKILL'); }
  stdout(): string { return this.output; }
  stderr(): string { return this.diagnostics; }
  records(): Array<Record<string, unknown>> {
    return this.output.split('\n').slice(0, -1).filter(line => line.trim()).map(line => JSON.parse(line) as Record<string, unknown>);
  }
  async waitForExit(): Promise<number | null> {
    if (!this.completion) throw new Error('No stdio process launched');
    return this.completion;
  }
}
