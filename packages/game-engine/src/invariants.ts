import { assertBoard } from './board.js';
import { requireRule } from './errors.js';
import {
  assertRoundResult,
  assertScoreState,
  getMatchWinner,
  isBlocked,
  remainingTeamPoints,
} from './scoring.js';
import {
  assertHands,
  assertSeat,
  assertTeam,
  dealTiles,
  teamOf,
} from './tiles.js';
import type { MatchState } from './types.js';

/** Checks domain snapshots, not a parser for untrusted JSON or a history replay. */
export function assertMatchState(state: MatchState): void {
  assertScoreState(state.score);
  const winner = getMatchWinner(state.score);
  if (state.phase === 'starter-selection') {
    assertTeam(state.eligibleTeam);
    assertHands(state.hands);
    requireRule(
      state.hands.every((hand) => hand.length === 7),
      'INVALID_STATE',
    );
    dealTiles(state.hands.flat());
    requireRule(
      Number.isSafeInteger(state.roundNumber) &&
        state.roundNumber >= 2 &&
        winner === null,
      'INVALID_STATE',
    );
    return;
  }
  requireRule(
    ['playing', 'round-ended', 'match-finished'].includes(state.phase),
    'INVALID_PHASE',
  );
  const { round } = state;
  assertSeat(round.starter);
  assertHands(round.hands);
  assertBoard(round.board);
  // This also proves canonical representation and conservation of all 28 tiles.
  dealTiles([...round.hands.flat(), ...round.board.map((piece) => piece.tile)]);
  requireRule(
    Number.isSafeInteger(round.number) && round.number >= 1,
    'INVALID_STATE',
  );
  requireRule(
    round.number === 1
      ? round.opening.kind === 'first' && round.opening.requiredTile === '1:1'
      : round.opening.kind === 'later',
    'INVALID_STATE',
  );
  const emptySeats = round.hands.flatMap((hand, seat) =>
    hand.length === 0 ? [seat] : [],
  );
  if (state.phase === 'playing') {
    assertSeat(state.turn);
    requireRule(
      winner === null &&
        emptySeats.length === 0 &&
        !isBlocked(round.board, round.hands),
      'INVALID_STATE',
    );
    if (round.board.length === 0) {
      requireRule(
        state.turn === round.starter &&
          round.hands.every((hand) => hand.length === 7),
        'INVALID_STATE',
      );
      if (round.opening.kind === 'first')
        requireRule(
          round.hands[round.starter].includes(round.opening.requiredTile),
          'INVALID_STATE',
        );
    }
    return;
  }
  assertRoundResult(state.result);
  const totals = remainingTeamPoints(round.hands);
  requireRule(
    totals.A === state.result.remainingPoints.A &&
      totals.B === state.result.remainingPoints.B,
    'INVALID_STATE',
  );
  if (state.result.kind === 'normal') {
    requireRule(
      emptySeats.length === 1 &&
        teamOf(emptySeats[0] as 0 | 1 | 2 | 3) === state.result.winner,
      'INVALID_STATE',
    );
  } else requireRule(isBlocked(round.board, round.hands), 'INVALID_STATE');
  requireRule(
    Number.isSafeInteger(state.awardedPoints) &&
      (state.result.kind === 'seka'
        ? state.awardedPoints === 0 &&
          state.score.sekaBank >= totals.A + totals.B
        : state.awardedPoints >= state.result.normalPoints &&
          state.score.sekaBank === 0),
    'INVALID_STATE',
  );
  if (state.phase === 'match-finished')
    requireRule(
      winner === state.winner && state.result.winner === state.winner,
      'INVALID_STATE',
    );
  else requireRule(winner === null, 'INVALID_STATE');
}
