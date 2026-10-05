/**
 * Axo's UI state: whether it is out, and the latest thing the user asked of it.
 * Lives in AgentUIState so it survives the unmount/remount around modal prompts.
 */

import type { AxoCommand } from './axoCommand.js';

export type AxoCueKind =
  | 'hello'
  | 'feed'
  | 'pet'
  | 'dance'
  | 'sleep'
  | 'wake'
  | 'say'
  | 'help'
  | 'home'
  /** Waiting on the model for an answer to `~axo <question>`. */
  | 'think'
  /** The model's answer, shown in Axo's bubble. */
  | 'answer';

export interface AxoCue {
  readonly kind: AxoCueKind;
  /** Increments per command so a repeated command replays. */
  readonly id: number;
  readonly at: number;
  readonly text?: string;
}

export interface AxoUIState {
  readonly enabled: boolean;
  readonly cue: AxoCue | null;
}

export const AXO_AWAY: AxoUIState = { enabled: false, cue: null };

function cueFor(command: AxoCommand): Pick<AxoCue, 'kind' | 'text'> {
  switch (command.kind) {
    case 'summon':
      return { kind: 'hello' };
    case 'say':
      return { kind: 'say', text: command.text };
    default:
      return { kind: command.kind };
  }
}

/** Brings Axo out (if needed) and plays a cue; repeated cues get fresh ids so they replay. */
export function withAxoCue(state: AxoUIState, cue: Pick<AxoCue, 'kind' | 'text'>, now: number): AxoUIState {
  return { enabled: true, cue: { ...cue, id: (state.cue?.id ?? 0) + 1, at: now } };
}

/**
 * Any `~axo` command brings Axo out first; `home` while Axo is away is a no-op.
 * `home` while out plays a goodbye — the UI calls {@link sendAxoHome} when it ends.
 */
export function applyAxoCommand(state: AxoUIState, command: AxoCommand, now: number): AxoUIState {
  if (!state.enabled && command.kind === 'home') return state;
  return withAxoCue(state, cueFor(command), now);
}

export function sendAxoHome(): AxoUIState {
  return AXO_AWAY;
}
