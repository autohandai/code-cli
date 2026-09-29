/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentOutputEvent, LLMRequest, LLMRetryEvent } from '../../types.js';
import { stripAnsiCodes } from '../../ui/displayUtils.js';

type DeltaHandler = NonNullable<LLMRequest['onDelta']>;

/**
 * Decides whether streamed content is prose meant for the user or a structured
 * protocol payload (legacy JSON tool calls, XML tool tags) that must never be
 * shown as text. Leading whitespace is held back until the first visible
 * character settles the question.
 */
class StreamedContentGate {
  private pending = '';
  private mode: 'pending' | 'text' | 'protocol' = 'pending';

  /** Returns the text that may be exposed for this delta; '' while undecided or in protocol mode. */
  accept(text: string): string {
    if (this.mode === 'protocol') return '';
    if (this.mode === 'text') return text;
    this.pending += text;
    const first = this.pending.trimStart()[0];
    if (!first) return '';
    this.mode = '{[<'.includes(first) ? 'protocol' : 'text';
    const exposed = this.mode === 'text' ? this.pending : '';
    this.pending = '';
    return exposed;
  }
}

/**
 * Text delivered to a consumer across request attempts. A provider retry
 * re-streams the reply from the start, so only the part beyond what the
 * interrupted attempt already delivered is handed out again.
 */
class DeliveredText {
  private attempt = '';
  private delivered = '';

  push(text: string): string {
    this.attempt += text;
    const fresh = this.attempt.slice(this.delivered.length);
    this.delivered += fresh;
    return fresh;
  }

  restart(): void {
    this.attempt = '';
  }

  covers(text: string): boolean {
    return this.delivered.length > 0 && this.delivered.trim() === text.trim();
  }
}

/** Runs every present delta handler in order; undefined when there is nothing to run. */
export function combineDeltaHandlers(...handlers: Array<DeltaHandler | undefined>): DeltaHandler | undefined {
  const present = handlers.filter((handler): handler is DeltaHandler => handler !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return (delta) => {
    for (const handler of present) handler(delta);
  };
}

/**
 * Forwards streamed model output to the agent's output listener as
 * `message_delta` / `thought_delta` events so protocol hosts (ACP, RPC) can
 * show the reply while it is still being generated. Structured protocol
 * payloads never leave as message text.
 */
export class StreamedOutputRelay {
  private gate = new StreamedContentGate();
  private readonly content = new DeliveredText();
  private readonly thought = new DeliveredText();

  constructor(private readonly emit: (event: AgentOutputEvent) => void) {}

  readonly onDelta: DeltaHandler = (delta) => {
    if (delta.type === 'reasoning') {
      const thought = this.thought.push(delta.text);
      if (thought) this.emit({ type: 'thought_delta', thought });
      return;
    }
    const content = this.content.push(this.gate.accept(delta.text));
    if (content) this.emit({ type: 'message_delta', content });
  };

  readonly onRetry = (event: LLMRetryEvent): void => {
    if (event.phase !== 'retrying') return;
    this.gate = new StreamedContentGate();
    this.content.restart();
    this.thought.restart();
  };

  /** Whether the final reply text reached listeners in full through deltas. */
  hasStreamedContent(response: string): boolean {
    return this.content.covers(response);
  }

  /** Whether the final thought text reached listeners in full through deltas. */
  hasStreamedThought(thought: string): boolean {
    return this.thought.covers(thought);
  }
}

/** A transient, bounded view; the completed response remains the sole history entry. */
export class StreamingResponsePreview {
  private readonly gate = new StreamedContentGate();
  private text = '';
  private rendered = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly render: (text: string | null) => void) {}

  readonly onDelta: DeltaHandler = (delta) => {
    if (this.disposed || delta.type !== 'content') return;
    const text = this.gate.accept(delta.text);
    if (!text) return;
    this.text = (this.text + text).slice(-4096);
    if (!this.rendered) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), 80);
  };

  private flush(): void {
    this.timer = undefined;
    this.rendered = true;
    // Do not let model output execute terminal control sequences in a live frame.
    const safeText = stripAnsiCodes(this.text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
    this.render(safeText.split('\n').slice(-12).join('\n'));
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.text = '';
    this.render(null);
  }
}
