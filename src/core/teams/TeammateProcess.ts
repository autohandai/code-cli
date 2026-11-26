/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { MessageRouter } from './MessageRouter.js';
import type { TeamMember, TeamMemberStatus, TeamTask } from './types.js';
import type { ProviderName } from '../../types.js';
import type { TeamModelAssignmentSource } from './TeamModelPolicy.js';
import { defineStateMachine, StateMachine } from '../../utils/stateMachine.js';

interface TeammateSpawnOptions {
  teamName: string;
  name: string;
  agentName: string;
  leadSessionId: string;
  provider?: ProviderName;
  model?: string;
  modelSource?: TeamModelAssignmentSource;
  workspacePath?: string;
  configPath?: string;
  requestedRole?: string;
  agentSource?: string;
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
const MAX_STDERR_BYTES = 16 * 1024;

/** Process lifecycle as seen by the lead. Only `created` may spawn and `exited` is final, so a teammate is single-use. */
export const TEAMMATE_LIFECYCLE = defineStateMachine({
  name: 'teammate-lifecycle',
  initial: 'created',
  transitions: {
    created: { spawn: 'spawning', idle: 'idle', work: 'working', shutdownAck: 'stopping' },
    spawning: { idle: 'idle', work: 'working', shutdownAck: 'stopping', transportFailed: 'stopping', exit: 'exited' },
    idle: { work: 'working', shutdownAck: 'stopping', transportFailed: 'stopping', exit: 'exited' },
    working: { idle: 'idle', shutdownAck: 'stopping', transportFailed: 'stopping', exit: 'exited' },
    stopping: { exit: 'exited' },
    exited: {},
  },
});

/** Stdio channel to the child; it outlives `exit` until `close` so buffered messages still drain. */
export const TEAMMATE_TRANSPORT = defineStateMachine({
  name: 'teammate-transport',
  initial: 'open',
  transitions: {
    open: { fail: 'failed', close: 'closed' },
    failed: { close: 'closed' },
    closed: {},
  },
});

type TeammateLifecycleState = keyof typeof TEAMMATE_LIFECYCLE.transitions;
type TeammateLifecycleEvent = 'spawn' | 'idle' | 'work' | 'shutdownAck' | 'transportFailed' | 'exit';

const STATUS_BY_STATE: Record<TeammateLifecycleState, TeamMemberStatus> = {
  created: 'spawning',
  spawning: 'spawning',
  idle: 'idle',
  working: 'working',
  stopping: 'shutdown',
  exited: 'shutdown',
};

const EVENT_BY_STATUS: Record<TeamMemberStatus, TeammateLifecycleEvent | undefined> = {
  spawning: undefined,
  idle: 'idle',
  working: 'work',
  shutdown: 'shutdownAck',
};

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
  private readonly lifecycle = new StateMachine(TEAMMATE_LIFECYCLE);
  private readonly transport = new StateMachine(TEAMMATE_TRANSPORT);
  private router = new MessageRouter();
  private exitCode: number | null | undefined;
  private error?: string;
  private termination?: Promise<void>;
  private onMessage?: MessageHandler;
  private readonly opts: TeammateSpawnOptions;

  constructor(opts: TeammateSpawnOptions) {
    this.opts = opts;
  }

  get status(): TeamMemberStatus {
    return STATUS_BY_STATE[this.lifecycle.state];
  }

  get name(): string {
    return this.opts.name;
  }

  get pid(): number {
    return this.child?.pid ?? 0;
  }

  get isRunning(): boolean {
    return this.child !== null && this.isChildRunning(this.child);
  }

  /** Applies a lead-observed status; writes that would revive a stopping or exited teammate are ignored. */
  setStatus(status: TeamMemberStatus): void {
    const event = EVENT_BY_STATUS[status];
    if (event) this.lifecycle.trySend(event);
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
    if (opts.provider) args.push('--provider', opts.provider);
    if (opts.model) args.push('--model', opts.model);
    if (opts.workspacePath) args.push('--path', opts.workspacePath);
    if (opts.configPath) args.push('--config', opts.configPath);
    return args;
  }

  static buildSpawnEnv(
    opts: TeammateSpawnOptions,
    baseEnv: NodeJS.ProcessEnv = process.env,
  ): NodeJS.ProcessEnv {
    return {
      ...baseEnv,
      AUTOHAND_TEAMMATE: '1',
      AUTOHAND_TEAM_NAME: opts.teamName,
      AUTOHAND_TEAMMATE_NAME: opts.name,
      AUTOHAND_TEAMMATE_AGENT: opts.agentName,
      AUTOHAND_TEAM_LEAD_SESSION_ID: opts.leadSessionId,
      ...(opts.provider ? { AUTOHAND_TEAM_PROVIDER: opts.provider } : {}),
      ...(opts.model ? { AUTOHAND_TEAM_MODEL: opts.model } : {}),
      ...(opts.requestedRole ? { AUTOHAND_TEAM_REQUESTED_ROLE: opts.requestedRole } : {}),
      ...(opts.agentSource ? { AUTOHAND_TEAM_AGENT_SOURCE: opts.agentSource } : {}),
    };
  }

  /**
   * Spawn the teammate child process. The child inherits the current
   * environment with `AUTOHAND_TEAMMATE=1` added, and communicates
   * via piped stdin/stdout using JSON-RPC.
   */
  spawn(onMessage: MessageHandler, onExit: (code: number | null) => void): void {
    if (!this.lifecycle.trySend('spawn')) {
      throw new Error(`Teammate "${this.name}" has already been spawned`);
    }
    const args = TeammateProcess.buildSpawnArgs(this.opts);
    const binPath = process.argv[1];
    this.onMessage = onMessage;
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [binPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: TeammateProcess.buildSpawnEnv(this.opts),
      });
    } catch (error) {
      this.transport.trySend('close');
      this.lifecycle.send('exit');
      this.exitCode = null;
      this.recordError(error);
      throw error;
    }
    this.child = child;

    const finish = (code: number | null): void => {
      if (!this.lifecycle.trySend('exit')) return;
      this.exitCode = code;
      onExit(code);
    };
    child.on('error', (error: Error) => {
      this.recordError(error);
      if (child.pid === undefined) {
        this.transport.trySend('close');
        finish(null);
      } else {
        this.handleTransportFailure(error);
      }
    });
    child.on('exit', finish);

    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream?.on('error', (error: Error) => this.handleTransportFailure(error));
    }

    const stopMessages = child.stdout
      ? this.router.onMessage(child.stdout, (message) => {
        if (this.transport.is('open')) onMessage(message);
      }, error => this.handleTransportFailure(error))
      : undefined;

    let stderrTail: Buffer = Buffer.alloc(0);
    let stderrTruncated = false;
    const flushStderr = (): void => {
      const stderr = stderrTail.toString().trim();
      stderrTail = Buffer.alloc(0);
      if (!stderr) return;
      const notice = stderrTruncated ? `[truncated; last ${MAX_STDERR_BYTES} bytes]\n` : '';
      this.logError(`[${this.opts.name} stderr] ${notice}${stderr}`);
    };
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      stderrTruncated ||= stderrTail.length + bytes.length > MAX_STDERR_BYTES;
      stderrTail = bytes.length >= MAX_STDERR_BYTES
        ? Buffer.from(bytes.subarray(bytes.length - MAX_STDERR_BYTES))
        : Buffer.concat([stderrTail.subarray(Math.max(0, stderrTail.length + bytes.length - MAX_STDERR_BYTES)), bytes]);
    });
    child.stderr?.on('end', flushStderr);

    child.on('close', (code: number | null) => {
      this.transport.trySend('close');
      stopMessages?.();
      try {
        flushStderr();
      } finally {
        finish(code);
      }
    });
  }

  /**
   * Send an arbitrary JSON-RPC message to the child process via stdin.
   */
  send(msg: { method: string; params: Record<string, unknown> }): boolean {
    if (this.child?.stdin && this.isRunning && this.transport.is('open')
      && !this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      try {
        this.router.send(this.child.stdin, msg);
        return true;
      } catch (error) {
        this.handleTransportFailure(error);
      }
    }
    return false;
  }

  /**
   * Assign a task to the teammate. Sets local status to 'working' and
   * sends a `team.assignTask` message.
   */
  assignTask(task: TeamTask): void {
    if (!this.lifecycle.is('working') && !this.lifecycle.trySend('work')) return;
    this.send({ method: 'team.assignTask', params: { task, waitForRunReady: true } });
  }

  /**
   * Forward a chat message to the teammate from another team member.
   */
  sendMessage(from: string, content: string): void {
    this.send({ method: 'team.message', params: { from, content } });
  }

  cancelTask(taskId: string, reason?: string, runId?: string): void {
    this.send({ method: 'team.cancelTask', params: {
      taskId, ...(reason !== undefined ? { reason } : {}), ...(runId !== undefined ? { runId } : {}),
    } });
  }

  /**
   * Push an updated task list to the teammate so it has current context
   * about overall team progress and dependencies.
   */
  sendContextUpdate(tasks: TeamTask[]): void {
    this.updateContext(tasks);
  }

  updateContext(tasks: TeamTask[]): void {
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
      try {
        this.child.kill(signal);
      } catch (error) {
        this.recordError(error);
      }
    }
  }

  /** Wait briefly for graceful exit, then escalate to SIGTERM and SIGKILL. */
  async terminate(options: TeammateTerminationOptions = {}): Promise<void> {
    if (this.termination) return this.termination;
    const termination = this.terminateChild(options);
    this.termination = termination;
    try {
      await termination;
    } finally {
      if (this.termination === termination) this.termination = undefined;
    }
  }

  private async terminateChild(options: TeammateTerminationOptions): Promise<void> {
    const child = this.child;
    if (!child || this.transport.is('closed')) return;

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
    return !this.transport.is('closed') && !this.lifecycle.is('exited')
      && child.exitCode === null && child.signalCode === null;
  }

  private recordError(error: unknown): void {
    if (this.error !== undefined) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.logError(`[${this.name}] ${this.error}`);
  }

  private logError(text: string): void {
    try {
      this.onMessage?.({ method: 'team.log', params: { level: 'error', text } });
    } catch {
      return;
    }
  }

  private handleTransportFailure(error: unknown): void {
    if (this.lifecycle.is('exited') || !this.transport.trySend('fail')) return;
    this.lifecycle.trySend('transportFailed');
    this.recordError(error);
    void this.terminate({ gracefulTimeoutMs: 0 });
  }

  private waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (this.transport.is('closed')) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (exited: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.off('close', onClose);
        child.off('error', onError);
        resolve(exited);
      };
      const onClose = (): void => {
        this.transport.trySend('close');
        finish(true);
      };
      const onError = (): void => {
        if (this.transport.is('closed')) finish(true);
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      timeout.unref?.();
      child.once('close', onClose);
      child.on('error', onError);

      if (this.transport.is('closed')) finish(true);
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
      status: this.status,
      ...(this.status === 'shutdown' ? { exitCode: this.exitCode ?? null } : {}),
      ...(this.error ? { error: this.error } : {}),
      provider: this.opts.provider,
      model: this.opts.model,
      modelSource: this.opts.modelSource,
      requestedRole: this.opts.requestedRole,
      agentSource: this.opts.agentSource,
    };
  }
}
