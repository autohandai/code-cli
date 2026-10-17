import { randomUUID } from 'node:crypto';
import { CloudClient, CloudRequestError, cloudSessionUrl, type CloudConversation, type CloudInteraction, type CloudJob, type CloudMessage } from './CloudClient.js';

export interface CloudSessionState {
  conversation: CloudConversation;
  messages: CloudMessage[];
  jobs: CloudJob[];
  interaction: CloudInteraction | null;
  selected: number;
  busy: boolean;
  connected: boolean;
  notice: string;
}
interface CloudSessionActions {
  open?(url: string): Promise<unknown>;
  confirmApproval?(interaction: CloudInteraction): Promise<boolean>;
  answerQuestions?(interaction: CloudInteraction): Promise<Array<{ id: string; value: string }> | null>;
  handoff?(): Promise<void>;
  detach?(): void;
}

export class CloudSession {
  private state: CloudSessionState;
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private refreshTask?: Promise<void>;
  private observation?: Promise<void>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private wakeRetry?: () => void;
  private pendingAdmission?: { content: string; requestId: string };

  constructor(private readonly client: CloudClient, conversation: CloudConversation, private readonly actions: CloudSessionActions = {}, private readonly executionMode: 'auto' | 'plan' = 'auto') {
    this.state = { conversation, messages: [], jobs: [], interaction: null, selected: 0, busy: false, connected: false, notice: 'Connecting to Autohand Cloud…' };
  }
  getSnapshot = (): CloudSessionState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(changes: Partial<CloudSessionState>): void {
    if (this.abort.signal.aborted) return;
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
  select(direction: number): void {
    const rows = this.state.jobs.filter(job => job.state === 'queued');
    this.update({ selected: rows.length ? Math.max(0, Math.min(rows.length - 1, this.state.selected + direction)) : -1 });
  }
  async refresh(transcript = true): Promise<void> {
    if (this.abort.signal.aborted) return;
    if (this.refreshTask) return this.refreshTask;
    const id = this.state.conversation.id, signal = this.abort.signal;
    this.refreshTask = (async () => {
      const [detail, queue, interactions] = await Promise.all([
        transcript ? this.client.detail(id, signal) : Promise.resolve(null),
        this.client.queue(id, signal), this.client.interactions(id, signal),
      ]);
      const selectedJob = this.state.jobs.filter(job => job.state === 'queued')[this.state.selected];
      const selected = selectedJob ? queue.jobs.filter(job => job.state === 'queued').findIndex(job => job.id === selectedJob.id) : this.state.selected;
      this.update({ ...(detail ? { conversation: detail.conversation, messages: detail.messages.slice(-50) } : {}), jobs: queue.jobs, interaction: interactions.interaction, selected, connected: true });
    })();
    try { await this.refreshTask; } finally { this.refreshTask = undefined; }
  }
  async start(): Promise<void> {
    if (this.observation || this.abort.signal.aborted) return;
    await this.refresh();
    this.update({ notice: 'Cloud session connected. Enter queues; ↑/↓ selects a queued row.' });
    this.observation = this.observe();
    this.scheduleRefresh();
  }
  private scheduleRefresh(): void {
    if (this.abort.signal.aborted) return;
    const active = this.state.jobs.some(job => ['scheduled', 'running', 'queued', 'waiting'].includes(job.state));
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh(false).catch(error => this.report(error)).finally(() => this.scheduleRefresh());
    }, active ? 5000 : 30_000);
  }
  private delay(ms: number): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      this.wakeRetry = resolve;
      this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.wakeRetry = undefined; resolve(); }, ms);
    });
  }
  private async observe(): Promise<void> {
    let failures = 0;
    while (!this.abort.signal.aborted) {
      try {
        for await (const event of this.client.events(this.state.conversation.id, this.abort.signal)) {
          const messages = new Map(this.state.messages.map(message => [message.id, message]));
          for (const message of event.messages) messages.set(message.id, message);
          this.update({ messages: [...messages.values()].slice(-50), connected: true });
        }
        failures = 0;
        await this.refresh(false);
      } catch (error) {
        if (this.abort.signal.aborted) return;
        this.report(error); failures++;
        if (error instanceof CloudRequestError && [401, 403, 404].includes(error.status)) return;
      }
      await this.delay(failures ? Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) : this.state.jobs.length ? 1000 : 15_000);
    }
  }
  private report(error: unknown): void { this.update({ connected: false, notice: error instanceof Error ? error.message : 'Cloud observation interrupted. Use /refresh to reconnect.' }); }

  async submit(input: string): Promise<boolean> {
    const text = input.trim();
    if (!text || this.state.busy || this.abort.signal.aborted) return false;
    this.update({ busy: true });
    try {
      const [command, ...args] = text.split(/\s+/);
      const id = this.state.conversation.id;
      if (command === '/open') {
        if (args.length > 1 || args[0] && !['web', 'desktop'].includes(args[0])) throw new Error('Usage: /open [web|desktop]');
        const url = cloudSessionUrl(id, this.client.identity.accountId, args[0] === 'desktop' ? 'desktop' : 'web');
        await this.actions.open?.(url);
        this.update({ notice: url });
      } else if (command === '/stop') {
        await this.client.stop(id, this.abort.signal); this.update({ notice: 'Cloud stop requested. Use /resume to continue queued messages.' }); await this.refresh();
      } else if (command === '/steer') {
        const selected = this.state.jobs.filter(job => job.state === 'queued')[this.state.selected];
        if (!selected) throw new Error('Queue a correction, select it with ↑/↓, then run /steer.');
        await this.client.steer(id, selected, this.abort.signal); this.update({ notice: 'Selected message sent as steering.' }); await this.refresh();
      } else if (command === '/resume') {
        await this.client.resume(id, this.abort.signal);
        this.update({ notice: 'Cloud queue resumed.' }); await this.refresh();
      } else if (command === '/approve' || command === '/decline' || command === '/answer') {
        const interaction = this.state.interaction;
        if (!interaction || interaction.state !== 'pending') throw new Error('There is no pending cloud request. Use /refresh to check.');
        if (interaction.payload.kind === 'question') {
          if (command !== '/answer') throw new Error('Use /answer to respond to the pending questions.');
          const answers = await this.actions.answerQuestions?.(interaction);
          if (answers) await this.client.answer(id, interaction, { kind: 'question', answers }, this.abort.signal);
        } else {
          if (command === '/answer') throw new Error('Review this operation, then use /approve or /decline.');
          if (command === '/decline' || await this.actions.confirmApproval?.(interaction)) await this.client.answer(id, interaction, { kind: 'approval', decision: command === '/decline' ? 'decline' : 'approve' }, this.abort.signal);
        }
        await this.refresh();
      } else if (command === '/handoff') {
        if (!this.actions.handoff) throw new Error('Local handoff is unavailable in this terminal. Use /open web.');
        await this.actions.handoff();
      } else if (command === '/quit' || command === '/exit' || command === '/detach') {
        this.actions.detach?.();
      } else if (command === '/refresh' || command === '/cloud') {
        await this.refresh(); this.update({ notice: 'Cloud session refreshed.' });
      } else if (command === '/help') {
        this.update({ notice: '/open [web|desktop] · /steer · /approve · /decline · /answer · /stop · /resume · /handoff · /refresh · /detach' });
      } else if (command.startsWith('/')) {
        throw new Error('Unknown cloud command. Type /help for cloud session commands.');
      } else {
        if (this.pendingAdmission?.content !== text) this.pendingAdmission = { content: text, requestId: randomUUID() };
        await this.client.send(id, text, this.state.conversation.model, this.pendingAdmission.requestId, this.executionMode, this.abort.signal);
        this.pendingAdmission = undefined;
        this.update({ notice: 'Message admitted to the cloud queue.' });
        try { await this.refresh(); }
        catch { this.update({ connected: false, notice: 'Message admitted to the cloud queue. Observation interrupted; use /refresh to check its progress.' }); }
      }
      return true;
    } catch (error) { this.report(error); return false; }
    finally { this.update({ busy: false }); }
  }
  dispose(): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.refreshTimer = undefined; this.retryTimer = undefined;
    this.wakeRetry?.(); this.wakeRetry = undefined;
    this.listeners.clear();
  }
  async settled(): Promise<void> { await Promise.allSettled([this.observation, this.refreshTask]); }
}
