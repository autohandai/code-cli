/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { shuffleInPlace } from './displayUtils.js';
import toolTips from './tool_tips.json' with { type: 'json' };

/**
 * Tips shown under the status line while the agent works.
 *
 * Edit `src/ui/tool_tips.json` to add or change them. Entries without a
 * `kind` are shown verbatim. `skill` and `command` entries are templates
 * expanded against the user's installed skills and the slash-command
 * registry, using the `{{skill}}`, `{{command}}` and `{{description}}`
 * placeholders.
 */
export type ToolTipKind = 'static' | 'skill' | 'command';

export interface ToolTip {
  kind?: ToolTipKind;
  text: string;
}

export interface TipContext {
  listSkills?: () => ReadonlyArray<{ name: string; description?: string }>;
  listCommands?: () => ReadonlyArray<{ command: string; description: string }>;
}

const FALLBACK_TIP = 'Type /help to see all available slash commands';

export const DEFAULT_TOOL_TIPS: ReadonlyArray<ToolTip> = toolTips.tips as ToolTip[];

function lowerFirst(value: string): string {
  const trimmed = value.trim();
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

function expandOne(tip: ToolTip, context: TipContext): string[] {
  if (typeof tip.text !== 'string' || tip.text.trim().length === 0) return [];
  switch (tip.kind) {
    case 'skill':
      return (context.listSkills?.() ?? [])
        .filter((skill) => skill.description?.trim())
        .map((skill) => fill(tip.text, { skill: skill.name, description: lowerFirst(skill.description ?? '') }));
    case 'command':
      return (context.listCommands?.() ?? [])
        .map((cmd) => fill(tip.text, { command: cmd.command, description: lowerFirst(cmd.description) }));
    default:
      return [tip.text];
  }
}

/** Turn the JSON tip list into concrete strings for the current session. */
export function expandToolTips(tips: ReadonlyArray<ToolTip>, context: TipContext): string[] {
  return tips.flatMap((tip) => expandOne(tip, context));
}

/**
 * Shuffle-bag random tip selector.
 * Returns each tip once before reshuffling, preventing repeats. Templates are
 * re-expanded on every refill so skills installed mid-session show up.
 */
export class TipsBag {
  private readonly tips: ReadonlyArray<ToolTip>;
  private readonly context: TipContext;
  private remaining: string[] = [];
  private poolSize = 0;

  constructor(tips: ReadonlyArray<ToolTip> = DEFAULT_TOOL_TIPS, context: TipContext = {}) {
    this.tips = tips;
    this.context = context;
    this.refill();
  }

  get size(): number {
    return this.poolSize;
  }

  next(): string {
    if (this.remaining.length === 0) this.refill();
    return this.remaining.pop() ?? FALLBACK_TIP;
  }

  private refill(): void {
    const expanded = expandToolTips(this.tips, this.context);
    this.poolSize = expanded.length;
    shuffleInPlace(expanded);
    this.remaining = expanded.length > 0 ? expanded : [FALLBACK_TIP];
  }
}
