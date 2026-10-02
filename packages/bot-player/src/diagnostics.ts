import { getOpenEnds } from '@domino/game-engine';
import type { Four, MatchState, Seat } from '@domino/game-engine';
import { handCounts, roundNumber } from './actions.js';
import { freeze } from './immutable.js';
import type {
  SimulationCommand,
  StateSummary,
  Strategy,
  TraceEntry,
} from './types.js';

export function summarizeState(state: MatchState): StateSummary {
  return freeze({
    phase: state.phase,
    roundNumber: roundNumber(state),
    turn: state.phase === 'playing' ? state.turn : null,
    starter: state.phase === 'starter-selection' ? null : state.round.starter,
    eligibleTeam:
      state.phase === 'starter-selection' ? state.eligibleTeam : null,
    handCounts: handCounts(state),
    boardCount:
      state.phase === 'starter-selection' ? 0 : state.round.board.length,
    openEnds:
      state.phase === 'starter-selection'
        ? null
        : getOpenEnds(state.round.board),
    score: {
      teams: { A: { ...state.score.teams.A }, B: { ...state.score.teams.B } },
      sekaBank: state.score.sekaBank,
    },
  });
}
export type FailureCode =
  | 'COMMAND_LIMIT'
  | 'ROUND_LIMIT'
  | 'ENGINE_REJECTED'
  | 'INVARIANT_FAILED'
  | 'NO_BOT_ACTION';
export interface FailureDiagnostic {
  readonly version: 'domino-simulation-v1';
  readonly code: FailureCode;
  readonly seed: number;
  readonly strategies: Four<Strategy>;
  readonly origin: 'fresh' | 'provided';
  readonly limits: { readonly maxCommands: number; readonly maxRounds: number };
  readonly safetyLimitHit: boolean;
  readonly commandIndex: number;
  readonly roundNumber: number;
  readonly phase: MatchState['phase'];
  readonly actingSeat: Seat | null;
  readonly attemptedCommand: SimulationCommand | null;
  readonly summary: StateSummary;
  readonly recentCommands: readonly TraceEntry[];
  readonly reason: string;
}
export class SimulationFailure extends Error {
  readonly diagnostic: FailureDiagnostic;
  constructor(diagnostic: FailureDiagnostic) {
    // Bounded recent history only; no hidden hands, complete boards, or raw thrown errors.
    super(JSON.stringify(diagnostic));
    this.name = 'SimulationFailure';
    this.diagnostic = freeze(diagnostic);
  }
}
/** Non-cryptographic transcript fingerprint; not a security primitive. */
export function hashTranscript(hash: number, text: string): number {
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}
