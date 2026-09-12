/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const MAX_STEERING_MESSAGES = 32;
export const MAX_STEERING_MESSAGE_LENGTH = 8_000;

/**
 * Messages the user sends into a running turn. The ReAct loop drains them at
 * the start of each iteration, after every tool result for the previous
 * assistant turn has been appended, so the model reads them on its very next
 * request without waiting for the turn to finish.
 */
export class SteeringQueue {
  private readonly pending: string[] = [];

  push(text: string): boolean {
    const content = text.trim();
    if (!content || content.length > MAX_STEERING_MESSAGE_LENGTH) return false;
    if (this.pending.length >= MAX_STEERING_MESSAGES) this.pending.shift();
    this.pending.push(content);
    return true;
  }

  drain(): string[] {
    return this.pending.splice(0);
  }

  get size(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending.length = 0;
  }
}
