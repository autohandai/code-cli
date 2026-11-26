/**
 * A minimal finite state machine: one field holds the current state, and a
 * declared transition table is the only way to change it.
 */

export type TransitionTable<S extends string, E extends string> = {
  readonly [State in S]: Readonly<Partial<Record<E, S>>>;
};

export interface StateMachineDefinition<S extends string, E extends string> {
  readonly name: string;
  readonly initial: S;
  readonly transitions: TransitionTable<S, E>;
}

export interface Transition<S extends string, E extends string> {
  readonly from: S;
  readonly event: E;
  readonly to: S;
}

export interface StateMachineOptions<S extends string, E extends string> {
  /** Start somewhere other than the definition's initial state (e.g. restore). */
  readonly initial?: S;
  readonly onTransition?: (transition: Transition<S, E>) => void;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`${machine}: cannot "${event}" from "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}

const hasOwn = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** Validates the table once so typos fail at module load, not mid-session. */
export function defineStateMachine<S extends string, E extends string>(
  definition: StateMachineDefinition<S, E>,
): StateMachineDefinition<S, E> {
  const { name, initial, transitions } = definition;
  if (!hasOwn(transitions, initial)) {
    throw new Error(`${name}: initial state "${initial}" is not declared`);
  }
  for (const [from, edges] of Object.entries<Partial<Record<string, string>>>(transitions)) {
    for (const [event, to] of Object.entries(edges)) {
      if (to === undefined || !hasOwn(transitions, to)) {
        throw new Error(`${name}: transition "${from} --${event}--> ${to}" targets an undeclared state`);
      }
    }
  }
  return definition;
}

export class StateMachine<S extends string, E extends string> {
  private current: S;

  constructor(
    private readonly definition: StateMachineDefinition<S, E>,
    private readonly options: StateMachineOptions<S, E> = {},
  ) {
    this.current = options.initial ?? definition.initial;
  }

  get state(): S {
    return this.current;
  }

  is(...states: readonly S[]): boolean {
    return states.includes(this.current);
  }

  can(event: E): boolean {
    return this.target(event) !== undefined;
  }

  /** Applies `event`, throwing {@link InvalidTransitionError} when it is not allowed. */
  send(event: E): S {
    const to = this.target(event);
    if (to === undefined) {
      throw new InvalidTransitionError(this.definition.name, this.current, event);
    }
    const from = this.current;
    this.current = to;
    this.options.onTransition?.({ from, event, to });
    return to;
  }

  /** Applies `event` when allowed; returns whether the state changed hands. */
  trySend(event: E): boolean {
    if (!this.can(event)) return false;
    this.send(event);
    return true;
  }

  private target(event: E): S | undefined {
    const edges: Partial<Record<E, S>> = this.definition.transitions[this.current];
    return hasOwn(edges, event) ? edges[event] : undefined;
  }
}

export function terminalStates<S extends string, E extends string>(definition: StateMachineDefinition<S, E>): S[] {
  return (Object.keys(definition.transitions) as S[]).filter(
    (state) => Object.keys(definition.transitions[state]).length === 0,
  );
}

export function reachableStates<S extends string, E extends string>(
  definition: StateMachineDefinition<S, E>,
): Set<S> {
  const seen = new Set<S>([definition.initial]);
  const queue: S[] = [definition.initial];
  for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
    for (const to of Object.values<S | undefined>(definition.transitions[state])) {
      if (to !== undefined && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}
