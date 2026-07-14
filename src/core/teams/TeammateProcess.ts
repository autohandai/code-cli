/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { MessageRouter } from './MessageRouter.js';
import type { TeamMember, TeamMemberStatus, TeamTask } from './types.js';

interface TeammateSpawnOptions {
  teamName: string;
  name: string;
  agentName: string;
  leadSessionId: string;
  model?: string;
  workspacePath?: string;
}

type MessageHandler = (msg: { method: string; params: Record<string, unknown> }) => void;

export interface TeammateTerminationOptions {
  gracefulTimeoutMs?: number;
  termTimeoutMs?: number;
  killTimeoutMs?: number;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 750;
const DEFAULT_TERM_TIMEOUT_MS = 750;
const DEFAULT_KILL_TIMEOUT_MS = 250;

/**
 * Manages spawning and communicating with a single autohand teammate child process.
 *
 * Each teammate runs as a separate Node.js process with piped stdio. Communication
 * uses newline-delimited JSON-RPC 2.0 messages over stdin/stdout, handled by
 * {@link MessageRouter}.
 *
 * Lifecycle:
 *  1. Construct with spawn options (team name, member name, agent, etc.)
 *  2. Call {@link spawn} to start the child process
 *  3. Use {@link assignTask}, {@link sendMessage}, or {@link send} to communicate
 *  4. Call {@link requestShutdown} for graceful exit or {@link kill} to force-terminate
 */
export class TeammateProcess {
  private child: ChildProcess | null = null;
  private childClosed = false;
  private router = new MessageRouter();
  private _status: TeamMemberStatus = 'spawning';
  private readonly opts: TeammateSpawnOptions;

  constructor(opts: TeammateSpawnOptions) {
    this.opts = opts;
  }

  get status(): TeamMemberStatus {
    return this._status;
  }

  get name(): string {
    return this.opts.name;
  }

  get pid(): number {
    return this.child?.pid ?? 0;
  }

  setStatus(status: TeamMemberStatus): void {
    this._status = status;
  }

  /**
   * Build the CLI arguments used to spawn a teammate child process.
   * This is a static helper so tests can verify argument construction
   * without actually spawning a process.
   */
  static buildSpawnArgs(opts: TeammateSpawnOptions): string[] {
    const args = [
      '--mode', 'teammate',
      '--team', opts.teamName,
      '--name', opts.name,
      '--agent', opts.agentName,
      '--lead-session', opts.leadSessionId,
    ];
    if (opts.model) args.push('--model', opts.model);
    if (opts.workspacePath) args.push('--path', opts.workspacePath);
    return args;
  }

  /**
   * Spawn the teammate child process. The child inherits the current
   * environment with `AUTOHAND_TEAMMATE=1` added, and communicates
   * via piped stdin/stdout using JSON-RPC.
   */
  spawn(onMessage: MessageHandler, onExit: (code: number | null) => void): void {
    const args = TeammateProcess.buildSpawnArgs(this.opts);
    const binPath = process.argv[1];
    this.child = spawn(process.execPath, [binPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AUTOHAND_TEAMMATE: '1' },
    });
    this.childClosed = false;

    if (this.child.stdout) {
      this.router.onMessage(this.child.stdout, onMessage);
    }

    if (this.child.stderr) {
      const chunks: Buffer[] = [];
      this.child.stderr.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      this.child.stderr.on('end', () => {
        if (chunks.length > 0) {
          const stderr = Buffer.concat(chunks).toString().trim();
          if (stderr) {
            onMessage({
              method: 'team.log',
              params: { level: 'error', text: `[${this.opts.name} stderr] ${stderr}` },
            });
          }
        }
      });
    }

    this.child.on('exit', (code) => {
      this._status = 'shutdown';
      onExit(code);
    });
    this.child.on('close', () => {
      this.childClosed = true;
    });
  }

  /**
   * Send an arbitrary JSON-RPC message to the child process via stdin.
   */
  send(msg: { method: string; params: Record<string, unknown> }): void {
    if (this.child?.stdin && this.isChildRunning(this.child)) {
      this.router.send(this.child.stdin, msg);
    }
  }

  /**
   * Assign a task to the teammate. Sets local status to 'working' and
   * sends a `team.assignTask` message.
   */
  assignTask(task: TeamTask): void {
    this._status = 'working';
    this.send({ method: 'team.assignTask', params: { task } });
  }

  /**
   * Forward a chat message to the teammate from another team member.
   */
  sendMessage(from: string, content: string): void {
    this.send({ method: 'team.message', params: { from, content } });
  }

  /**
   * Push an updated task list to the teammate so it has current context
   * about overall team progress and dependencies.
   */
  sendContextUpdate(tasks: TeamTask[]): void {
    this.send({ method: 'team.updateContext', params: { tasks } });
  }

  /**
   * Request a graceful shutdown. The teammate should acknowledge via
   * `team.shutdownAck` and then exit.
   */
  requestShutdown(reason: string): void {
    this.send({ method: 'team.shutdown', params: { reason } });
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.child && this.isChildRunning(this.child)) {
      this.child.kill(signal);
    }
  }

  /** Wait briefly for graceful exit, then escalate to SIGTERM and SIGKILL. */
  async terminate(options: TeammateTerminationOptions = {}): Promise<void> {
    const child = this.child;
    if (!child || this.childClosed) return;

    const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;
    const termTimeoutMs = options.termTimeoutMs ?? DEFAULT_TERM_TIMEOUT_MS;
    const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;

    if (await this.waitForChildExit(child, gracefulTimeoutMs)) return;
    this.kill('SIGTERM');
    if (await this.waitForChildExit(child, termTimeoutMs)) return;
    this.kill('SIGKILL');
    await this.waitForChildExit(child, killTimeoutMs);
  }

  private isChildRunning(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null;
  }

  private waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (this.childClosed) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (exited: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.off('close', onClose);
        resolve(exited);
      };
      const onClose = (): void => {
        this.childClosed = true;
        finish(true);
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      timeout.unref?.();
      child.once('close', onClose);

      if (this.childClosed) finish(true);
    });
  }

  /**
   * Return a snapshot of this teammate as a plain {@link TeamMember} object,
   * suitable for serialization or display.
   */
  toMember(): TeamMember {
    return {
      name: this.opts.name,
      agentName: this.opts.agentName,
      pid: this.pid,
      status: this._status,
      model: this.opts.model,
    };
  }
}
