/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { StateMachine, defineStateMachine } from '../../utils/stateMachine.js';

export type TurnPhase = 'idle' | 'admitted' | 'preparing' | 'running' | 'finishing';
export type TurnPhaseEvent = 'admit' | 'prepare' | 'start' | 'finish' | 'settle';

/**
 * admitted: pre-prompt hooks and native permission checks.
 * preparing: directory permissions, environment bootstrap, UI start.
 * running: specialists, context, the ReAct loop and quality checks.
 * finishing: teardown and usage accounting.
 * Every active phase can settle so a throw anywhere returns the agent to idle.
 */
export const TURN_PHASE = defineStateMachine<TurnPhase, TurnPhaseEvent>({
  name: 'TurnPhase',
  initial: 'idle',
  transitions: {
    idle: { admit: 'admitted' },
    admitted: { prepare: 'preparing', settle: 'idle' },
    preparing: { start: 'running', settle: 'idle' },
    running: { finish: 'finishing', settle: 'idle' },
    finishing: { settle: 'idle' },
  },
});

/** The single owner of whether an instruction turn is in flight, and how far it has got. */
export class TurnActivity {
  private readonly machine: StateMachine<TurnPhase, TurnPhaseEvent>;

  constructor(onActiveChange?: (active: boolean) => void) {
    this.machine = new StateMachine(TURN_PHASE, {
      onTransition: ({ from, to }) => {
        if ((from === 'idle') !== (to === 'idle')) onActiveChange?.(to !== 'idle');
      },
    });
  }

  get phase(): TurnPhase {
    return this.machine.state;
  }

  get active(): boolean {
    return !this.machine.is('idle');
  }

  admit(): void {
    this.machine.send('admit');
  }

  prepare(): void {
    this.machine.send('prepare');
  }

  start(): void {
    this.machine.send('start');
  }

  /** Runs inside teardown, so it never throws. */
  finish(): void {
    this.machine.trySend('finish');
  }

  settle(): void {
    this.machine.trySend('settle');
  }

  /** For writers that only know a boolean: `true` admits an idle turn, `false` settles. */
  setActive(active: boolean): void {
    if (active) this.machine.trySend('admit');
    else this.settle();
  }
}

export interface TurnActivityHost {
  turnActivity?: TurnActivity;
  isInstructionActive: boolean;
}

/** The host's own activity, or one that publishes its edges to the host's boolean. */
export function resolveTurnActivity(host: TurnActivityHost): TurnActivity {
  host.turnActivity ??= new TurnActivity((active) => {
    host.isInstructionActive = active;
  });
  return host.turnActivity;
}

/** Counts open modals; releases are idempotent tokens so nested modals cannot close each other. */
export class ModalDepth {
  private depth = 0;

  constructor(private readonly onVisibleChange?: (visible: boolean) => void) {}

  get visible(): boolean {
    return this.depth > 0;
  }

  enter(): () => void {
    this.depth += 1;
    if (this.depth === 1) this.onVisibleChange?.(true);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      this.depth -= 1;
      if (this.depth === 0) this.onVisibleChange?.(false);
    };
  }
}
