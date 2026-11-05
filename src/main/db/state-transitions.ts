/**
 * Declares the legal transitions of a persisted state column.
 *
 * Every state lists the states it may move to. Terminal states list none.
 * A state may list itself when a same-state write (such as a progress
 * observation) is legal.
 */
export type StateTransitions<State extends string> = Readonly<Record<State, readonly State[]>>

export function canTransition<State extends string>(
  transitions: StateTransitions<State>,
  from: State,
  to: State
): boolean {
  return transitions[from].includes(to)
}

export function isTerminalState<State extends string>(
  transitions: StateTransitions<State>,
  state: State
): boolean {
  return transitions[state].length === 0
}
