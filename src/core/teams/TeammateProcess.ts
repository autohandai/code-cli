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

    if (this.child.stdout) {
      this.router.onMessage(this.child.stdout, onMessage);
    }

    this.child.on('exit', (code) => {
      this._status = 'shutdown';
      onExit(code);
    });
  }

  /**
   * Send an arbitrary JSON-RPC message to the child process via stdin.
   */
  send(msg: { method: string; params: Record<string, unknown> }): void {
    if (this.child?.stdin && !this.child.killed) {
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
   * Request a graceful shutdown. The teammate should acknowledge via
   * `team.shutdownAck` and then exit.
   */
  requestShutdown(reason: string): void {
    this.send({ method: 'team.shutdown', params: { reason } });
  }

  /**
   * Force-terminate the child process with SIGTERM.
   */
  kill(): void {
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
    }
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
