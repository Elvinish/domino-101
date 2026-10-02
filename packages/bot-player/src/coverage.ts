import { getLegalMoves, isDouble } from '@domino/game-engine';
import type { MatchState } from '@domino/game-engine';
import type { Coverage, SimulationCommand } from './types.js';

export function createCoverage(): Coverage {
  return {
    passes: 0,
    ambiguousPlacements: 0,
    starterSelections: 0,
    startersWithoutDouble: 0,
    startersWithMultipleDoubles: 0,
    pendingAccumulations: 0,
    pendingBurns: 0,
    scoreOpenings: 0,
    bankClaims: 0,
    consecutiveSeka: 0,
  };
}
/** Observational counters only: no rule outcomes are fed back into the engine. */
export function updateCoverage(
  coverage: Coverage,
  before: MatchState,
  command: SimulationCommand,
  after: MatchState,
  previousRoundWasSeka: boolean,
): Coverage {
  const next = { ...coverage };
  if (command.type === 'pass') next.passes++;
  if (command.type === 'select-starter') next.starterSelections++;
  if (command.type === 'play' && before.phase === 'playing') {
    if (
      getLegalMoves(before, command.seat).filter(
        (move) => move.tile === command.tile,
      ).length > 1
    )
      next.ambiguousPlacements++;
    if (before.round.number > 1 && before.round.board.length === 0) {
      const doubles = before.round.hands[command.seat].filter(isDouble).length;
      if (doubles === 0) next.startersWithoutDouble++;
      if (doubles > 1) next.startersWithMultipleDoubles++;
    }
  }
  if (
    before.phase === 'playing' &&
    (after.phase === 'round-ended' || after.phase === 'match-finished')
  ) {
    if (after.result.kind === 'seka' && previousRoundWasSeka)
      next.consecutiveSeka++;
    if (after.result.kind !== 'seka' && before.score.sekaBank > 0)
      next.bankClaims++;
    for (const team of ['A', 'B'] as const) {
      const old = before.score.teams[team];
      const current = after.score.teams[team];
      if (!old.isScoreOpened && current.isScoreOpened) next.scoreOpenings++;
      if (
        old.pendingOpeningPoints > 0 &&
        current.pendingOpeningPoints > old.pendingOpeningPoints
      )
        next.pendingAccumulations++;
      if (
        old.pendingOpeningPoints > 0 &&
        current.pendingOpeningPoints === 0 &&
        !current.isScoreOpened
      )
        next.pendingBurns++;
    }
  }
  return next;
}
