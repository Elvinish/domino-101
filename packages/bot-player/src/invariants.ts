import {
  assertMatchState,
  createDeck,
  EngineError,
  getLegalMoves,
  nextSeat,
  passTurn,
  playTile,
  SEATS,
  selectStarter,
  teamOf,
} from '@domino/game-engine';
import type { MatchState } from '@domino/game-engine';
import { roundNumber } from './actions.js';
import type { SimulationCommand } from './types.js';

export class InvariantFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'InvariantFailure';
  }
}
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new InvariantFailure(code);
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function assertSimulationState(state: MatchState): void {
  const hands =
    state.phase === 'starter-selection' ? state.hands : state.round.hands;
  const tiles = [
    ...hands.flat(),
    ...(state.phase === 'starter-selection'
      ? []
      : state.round.board.map((piece) => piece.tile)),
  ];
  check(
    tiles.length === 28 &&
      new Set(tiles).size === 28 &&
      createDeck().every((tile) => tiles.includes(tile)),
    'TILE_CONSERVATION',
  );
  check(hands.length === 4, 'FOUR_SEATS');
  check(
    SEATS.every((seat) => teamOf(seat) === (seat % 2 === 0 ? 'A' : 'B')),
    'TEAM_MAPPING',
  );
  for (const team of ['A', 'B'] as const) {
    const score = state.score.teams[team];
    check(
      Number.isSafeInteger(score.officialScore) &&
        score.officialScore >= 0 &&
        Number.isSafeInteger(score.pendingOpeningPoints) &&
        score.pendingOpeningPoints >= 0,
      'NONNEGATIVE_SCORES',
    );
  }
  check(
    Number.isSafeInteger(state.score.sekaBank) && state.score.sekaBank >= 0,
    'NONNEGATIVE_BANK',
  );
  if (state.phase === 'playing')
    check(SEATS.includes(state.turn), 'VALID_TURN');
  if (state.phase === 'match-finished')
    check(
      state.score.teams[state.winner].officialScore >= 101,
      'MATCH_THRESHOLD',
    );
  else
    check(
      state.score.teams.A.officialScore < 101 &&
        state.score.teams.B.officialScore < 101,
      'MATCH_MUST_FINISH',
    );
  try {
    assertMatchState(state);
  } catch {
    throw new InvariantFailure('ENGINE_STATE');
  }
}
function rejected(action: () => unknown, expected: string): void {
  try {
    action();
  } catch (error) {
    check(
      error instanceof EngineError && error.code === expected,
      'WRONG_REJECTION',
    );
    return;
  }
  throw new InvariantFailure('ILLEGAL_COMMAND_ACCEPTED');
}
/** Negative probes: the production engine must reject invalid commands itself. */
export function assertIllegalCommandsRejected(state: MatchState): void {
  if (state.phase === 'playing') {
    const moves = getLegalMoves(state, state.turn);
    if (moves.length > 0)
      rejected(() => passTurn(state, state.turn), 'PASS_NOT_ALLOWED');
    const illegal = state.round.hands[state.turn].find(
      (tile) => !moves.some((move) => move.tile === tile),
    );
    if (illegal)
      rejected(
        () => playTile(state, state.turn, illegal, 'left'),
        'ILLEGAL_TILE',
      );
    else {
      const foreign = state.round.hands[nextSeat(state.turn)][0]!;
      rejected(
        () => playTile(state, state.turn, foreign, 'left'),
        'TILE_NOT_IN_HAND',
      );
    }
    if (state.round.board.length > 0 && moves.length > 0) {
      rejected(
        () => playTile(state, state.turn, moves[0]!.tile, 'start'),
        'INVALID_END',
      );
    }
  } else if (state.phase === 'starter-selection') {
    const opponent = SEATS.find((seat) => teamOf(seat) !== state.eligibleTeam)!;
    rejected(() => selectStarter(state, opponent), 'STARTER_NOT_ELIGIBLE');
  } else if (state.phase === 'match-finished') {
    rejected(() => passTurn(state, 0), 'INVALID_PHASE');
    rejected(() => playTile(state, 0, '0:0'), 'INVALID_PHASE');
    rejected(() => selectStarter(state, 0), 'INVALID_PHASE');
  }
}
export function assertSimulationTransition(
  before: MatchState,
  command: SimulationCommand,
  after: MatchState,
): void {
  check(before.phase !== 'match-finished', 'NO_PLAY_AFTER_FINISH');
  assertSimulationState(after);
  for (const team of ['A', 'B'] as const)
    check(
      after.score.teams[team].officialScore >=
        before.score.teams[team].officialScore,
      'SCORE_MONOTONIC',
    );
  if (command.type === 'next-round') {
    check(
      before.phase === 'round-ended' &&
        roundNumber(after) === before.round.number + 1,
      'NEXT_ROUND_PHASE',
    );
    check(equal(before.score, after.score), 'DEAL_PRESERVES_SCORE');
    if (before.result.kind === 'seka')
      check(
        after.phase === 'playing' &&
          after.round.starter === before.round.starter &&
          after.turn === before.round.starter,
        'SEKA_STARTER_RIGHTS',
      );
    else
      check(
        after.phase === 'starter-selection' &&
          after.eligibleTeam === before.result.winner,
        'WINNER_STARTER_RIGHTS',
      );
    return;
  }
  if (command.type === 'select-starter') {
    check(
      before.phase === 'starter-selection' &&
        teamOf(command.seat) === before.eligibleTeam &&
        teamOf(command.selected) === before.eligibleTeam,
      'STARTER_ELIGIBILITY',
    );
    check(
      after.phase === 'playing' &&
        after.turn === command.selected &&
        after.round.starter === command.selected &&
        after.round.number === before.roundNumber,
      'STARTER_LOCK',
    );
    check(
      equal(before.hands, after.round.hands) &&
        equal(before.score, after.score),
      'SELECTION_PRESERVES_STATE',
    );
    rejected(() => selectStarter(after, command.seat), 'INVALID_PHASE');
    return;
  }
  check(
    before.phase === 'playing' &&
      before.turn === command.seat &&
      after.phase !== 'starter-selection',
    'ACTING_TURN',
  );
  check(
    after.round.number === before.round.number &&
      after.round.starter === before.round.starter,
    'ROUND_IDENTITY',
  );
  const legal = getLegalMoves(before, command.seat);
  if (command.type === 'pass') {
    check(legal.length === 0, 'LEGAL_PASS');
    check(
      after.phase === 'playing' &&
        equal(before.round, after.round) &&
        equal(before.score, after.score),
      'PASS_PRESERVES_STATE',
    );
  } else {
    check(
      legal.some(
        (move) => move.tile === command.tile && move.end === command.end,
      ),
      'LEGAL_PLACEMENT',
    );
    check(
      after.round.board.length === before.round.board.length + 1,
      'BOARD_GROWS',
    );
    for (const seat of SEATS)
      check(
        equal(
          after.round.hands[seat],
          seat === command.seat
            ? before.round.hands[seat].filter((tile) => tile !== command.tile)
            : before.round.hands[seat],
        ),
        'HAND_TRANSITION',
      );
  }
  if (after.phase === 'playing') {
    check(after.turn === nextSeat(command.seat), 'TURN_PROGRESSION');
    check(equal(before.score, after.score), 'NO_MIDROUND_SCORING');
    return;
  }
  if (after.result.kind === 'seka') {
    check(
      equal(before.score.teams, after.score.teams) &&
        after.score.sekaBank ===
          before.score.sekaBank +
            after.result.remainingPoints.A +
            after.result.remainingPoints.B &&
        after.awardedPoints === 0,
      'SEKA_ACCOUNTING',
    );
  } else {
    check(
      after.awardedPoints ===
        after.result.normalPoints + before.score.sekaBank &&
        after.score.sekaBank === 0,
      'BANK_CLAIM',
    );
    const loser = after.result.winner === 'A' ? 'B' : 'A';
    if (!before.score.teams[loser].isScoreOpened)
      check(
        after.score.teams[loser].pendingOpeningPoints === 0,
        'PENDING_BURN',
      );
  }
}
