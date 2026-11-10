import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class TmuxTestServer {
  private readonly socketName = `autohand-test-${randomUUID()}`;
  private readonly executable: string;

  constructor() {
    const found = spawnSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
    if (found.status !== 0 || !found.stdout.trim()) throw new Error('Terminal integration tests require tmux on PATH.');
    this.executable = found.stdout.trim();
  }

  async prepare(directory: string): Promise<string> {
    await mkdir(directory, { recursive: true });
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    const config = path.join(directory, 'tmux.conf');
    await writeFile(config, 'set -g remain-on-exit failed\n');
    await writeFile(path.join(directory, 'tmux'),
      `#!/bin/sh\nexec ${quote(this.executable)} -L ${quote(this.socketName)} -f ${quote(config)} "$@"\n`, { mode: 0o755 });
    return `${directory}${path.delimiter}${process.env.PATH ?? ''}`;
  }

  stop(): void {
    spawnSync(this.executable, ['-L', this.socketName, 'kill-server'], { stdio: 'ignore', timeout: 5_000 });
  }

  snapshot(): { text: string; historySize: number } {
    const capture = (args: string[]) => {
      const result = spawnSync(this.executable, ['-L', this.socketName, ...args], { encoding: 'utf8', timeout: 5_000 });
      if (result.status !== 0) throw new Error(`Could not inspect the test tmux pane: ${result.stderr}`);
      return result.stdout;
    };
    return { text: capture(['capture-pane', '-p', '-S', '-']),
      historySize: Number(capture(['display-message', '-p', '#{history_size}']).trim()) };
  }
}
