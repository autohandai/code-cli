/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMRequest } from '../../types.js';
import { stripAnsiCodes } from '../../ui/displayUtils.js';

/** A transient, bounded view; the completed response remains the sole history entry. */
export class StreamingResponsePreview {
  private text = '';
  private mode: 'pending' | 'text' | 'protocol' = 'pending';
  private rendered = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly render: (text: string | null) => void) {}

  readonly onDelta: NonNullable<LLMRequest['onDelta']> = (delta) => {
    if (this.disposed || delta.type !== 'content' || this.mode === 'protocol') return;
    this.text = (this.text + delta.text).slice(-4096);
    if (this.mode === 'pending') {
      const first = this.text.trimStart()[0];
      if (!first) return;
      this.mode = '{[<'.includes(first) ? 'protocol' : 'text';
      if (this.mode === 'protocol') { this.text = ''; return; }
    }
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
