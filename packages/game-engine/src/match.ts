import { legalMovesForHand, placeTile } from './board.js';
import { freeze, requireRule } from './errors.js';
import { assertMatchState } from './invariants.js';
import {
  applyRoundResult,
  createScoreState,
  isBlocked,
  remainingTeamPoints,
  resolveBlockedRound,
} from './scoring.js';
import {
  assertSeat,
  dealTiles,
  findFirstStarter,
  isTile,
  nextSeat,
  otherTeam,
  teamOf,
} from './tiles.js';
import type {
  Hands,
  LegalMove,
  MatchState,
  MoveEnd,
  PlayingState,
  Round,
  RoundResult,
  ScoreState,
  Seat,
  Tile,
} from './types.js';

function copyHands(hands: Hands): [Tile[], Tile[], Tile[], Tile[]] {
  return [[...hands[0]], [...hands[1]], [...hands[2]], [...hands[3]]];
}
function copyScore(score: ScoreState): ScoreState {
  return {
    teams: { A: { ...score.teams.A }, B: { ...score.teams.B } },
    sekaBank: score.sekaBank,
  };
}
function copyRound(round: Round): Round {
  return {
    ...round,
    opening: { ...round.opening },
    hands: copyHands(round.hands),
    board: round.board.map((piece) => ({ ...piece })),
  };
}
function checked<T extends MatchState>(state: T): T {
  assertMatchState(state);
  return freeze(state);
}
function requireTurn(
  state: MatchState,
  seat: Seat,
): asserts state is PlayingState {
  assertMatchState(state);
  assertSeat(seat);
  requireRule(state.phase === 'playing', 'INVALID_PHASE');
  requireRule(state.turn === seat, 'NOT_YOUR_TURN');
}
export function createMatch(deck: readonly Tile[]): PlayingState {
  const hands = dealTiles(deck);
  const first = findFirstStarter(hands);
  return checked({
    phase: 'playing',
    score: createScoreState(),
    turn: first.seat,
    round: {
      number: 1,
      starter: first.seat,
      opening: { kind: 'first', requiredTile: first.requiredTile },
      hands,
      board: [],
    },
  });
}
export function getLegalMoves(
  state: MatchState,
  seat: Seat,
): readonly LegalMove[] {
  requireTurn(state, seat);
  return legalMovesForHand(
    state.round.board,
    state.round.hands[seat],
    state.round.opening,
  );
}
function finishRound(
  score: ScoreState,
  round: Round,
  result: RoundResult,
): MatchState {
  const outcome = applyRoundResult(score, result);
  if (outcome.matchWinner !== null) {
    requireRule(result.kind !== 'seka', 'INVALID_RESULT');
    return checked({
      phase: 'match-finished',
      score: outcome.score,
      round,
      result,
      awardedPoints: outcome.awardedPoints,
      winner: outcome.matchWinner,
    });
  }
  return checked({
    phase: 'round-ended',
    score: outcome.score,
    round,
    result,
    awardedPoints: outcome.awardedPoints,
  });
}
export function playTile(
  state: MatchState,
  seat: Seat,
  tile: Tile,
  end?: MoveEnd,
): MatchState {
  requireTurn(state, seat);
  requireRule(isTile(tile), 'INVALID_TILE');
  requireRule(state.round.hands[seat].includes(tile), 'TILE_NOT_IN_HAND');
  const moves = legalMovesForHand(
    state.round.board,
    state.round.hands[seat],
    state.round.opening,
  );
  requireRule(
    moves.some((move) => move.tile === tile),
    'ILLEGAL_TILE',
  );
  const board = placeTile(state.round.board, tile, end);
  const hands = copyHands(state.round.hands);
  hands[seat] = hands[seat].filter((held) => held !== tile);
  const round: Round = {
    ...state.round,
    opening: { ...state.round.opening },
    hands,
    board,
  };
  // Going out takes precedence over blocked-round detection.
  if (hands[seat].length === 0) {
    const winner = teamOf(seat);
    const totals = remainingTeamPoints(hands);
    return finishRound(state.score, round, {
      kind: 'normal',
      winner,
      normalPoints: totals[otherTeam(winner)],
      remainingPoints: totals,
    });
  }
  if (isBlocked(board, hands))
    return finishRound(state.score, round, resolveBlockedRound(board, hands));
  return checked({
    phase: 'playing',
    score: copyScore(state.score),
    round,
    turn: nextSeat(seat),
  });
}
export function passTurn(state: MatchState, seat: Seat): PlayingState {
  requireTurn(state, seat);
  requireRule(
    legalMovesForHand(
      state.round.board,
      state.round.hands[seat],
      state.round.opening,
    ).length === 0,
    'PASS_NOT_ALLOWED',
  );
  return checked({
    phase: 'playing',
    score: copyScore(state.score),
    round: copyRound(state.round),
    turn: nextSeat(seat),
  });
}
/** Deal before selection. A SEKA preserves the exact prior starter automatically. */
export function startNextRound(
  state: MatchState,
  deck: readonly Tile[],
): MatchState {
  assertMatchState(state);
  requireRule(state.phase === 'round-ended', 'INVALID_PHASE');
  const hands = dealTiles(deck);
  const number = state.round.number + 1;
  const score = copyScore(state.score);
  if (state.result.kind === 'seka') {
    return checked({
      phase: 'playing',
      score,
      turn: state.round.starter,
      round: {
        number,
        starter: state.round.starter,
        opening: { kind: 'later' },
        hands,
        board: [],
      },
    });
  }
  return checked({
    phase: 'starter-selection',
    score,
    roundNumber: number,
    hands,
    eligibleTeam: state.result.winner,
  });
}
/** An eligible partner may select either eligible partner, including themselves. */
export function selectStarter(
  state: MatchState,
  actor: Seat,
  selected: Seat = actor,
): PlayingState {
  assertMatchState(state);
  assertSeat(actor);
  assertSeat(selected);
  requireRule(state.phase === 'starter-selection', 'INVALID_PHASE');
  requireRule(
    teamOf(actor) === state.eligibleTeam &&
      teamOf(selected) === state.eligibleTeam,
    'STARTER_NOT_ELIGIBLE',
  );
  return checked({
    phase: 'playing',
    score: copyScore(state.score),
    turn: selected,
    round: {
      number: state.roundNumber,
      starter: selected,
      opening: { kind: 'later' },
      hands: copyHands(state.hands),
      board: [],
    },
  });
}
