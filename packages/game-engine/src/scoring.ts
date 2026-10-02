import { freeze, requireRule } from './errors.js';
import { legalMovesForHand } from './board.js';
import {
  assertHands,
  assertTeam,
  otherTeam,
  isTile,
  tilePips,
} from './tiles.js';
import type {
  Board,
  Hand,
  Hands,
  RoundResult,
  ScoreState,
  Team,
  TeamScore,
  TeamTotals,
} from './types.js';

function points(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
export function createScoreState(): ScoreState {
  return freeze({
    teams: {
      A: { isScoreOpened: false, officialScore: 0, pendingOpeningPoints: 0 },
      B: { isScoreOpened: false, officialScore: 0, pendingOpeningPoints: 0 },
    },
    sekaBank: 0,
  });
}
export function scoreHand(hand: Hand): number {
  requireRule(
    Array.isArray(hand) &&
      hand.length <= 7 &&
      Array.from(hand).every(isTile) &&
      new Set(hand).size === hand.length,
    'INVALID_HANDS',
  );
  if (hand.length === 1 && hand[0] === '0:0') return 10;
  return hand.reduce((total, tile) => {
    const [a, b] = tilePips(tile);
    return total + a + b;
  }, 0);
}
export function remainingTeamPoints(hands: Hands): TeamTotals {
  assertHands(hands);
  return Object.freeze({
    A: scoreHand(hands[0]) + scoreHand(hands[2]),
    B: scoreHand(hands[1]) + scoreHand(hands[3]),
  });
}
export function isBlocked(board: Board, hands: Hands): boolean {
  assertHands(hands);
  // Empty boards and already empty hands are not blocked-round results.
  return (
    board.length > 0 &&
    hands.every(
      (hand) => hand.length > 0 && legalMovesForHand(board, hand).length === 0,
    )
  );
}
export function resolveBlockedRound(board: Board, hands: Hands): RoundResult {
  requireRule(isBlocked(board, hands), 'NOT_BLOCKED');
  const totals = remainingTeamPoints(hands);
  if (totals.A === totals.B)
    return freeze({ kind: 'seka', remainingPoints: totals });
  const winner = totals.A < totals.B ? 'A' : 'B';
  return freeze({
    kind: 'baglanma',
    winner,
    normalPoints: totals[otherTeam(winner)],
    remainingPoints: totals,
  });
}
export function assertScoreState(score: ScoreState): void {
  requireRule(points(score.sekaBank), 'INVALID_SCORE');
  for (const team of ['A', 'B'] as const) {
    const value = score.teams[team];
    requireRule(
      points(value.officialScore) && points(value.pendingOpeningPoints),
      'INVALID_SCORE',
    );
    requireRule(
      value.isScoreOpened === true
        ? value.pendingOpeningPoints === 0 && value.officialScore >= 13
        : value.isScoreOpened === false && value.officialScore === 0,
      'INVALID_SCORE',
    );
  }
  requireRule(
    !(
      score.teams.A.pendingOpeningPoints > 0 &&
      score.teams.B.pendingOpeningPoints > 0
    ),
    'INVALID_SCORE',
  );
  requireRule(
    !(score.teams.A.officialScore >= 101 && score.teams.B.officialScore >= 101),
    'INVALID_SCORE',
  );
}
export function assertRoundResult(result: RoundResult): void {
  requireRule(
    points(result.remainingPoints.A) && points(result.remainingPoints.B),
    'INVALID_RESULT',
  );
  if (result.kind === 'seka') {
    requireRule(
      result.remainingPoints.A === result.remainingPoints.B,
      'INVALID_RESULT',
    );
    return;
  }
  requireRule(
    result.kind === 'normal' || result.kind === 'baglanma',
    'INVALID_RESULT',
  );
  assertTeam(result.winner);
  requireRule(
    points(result.normalPoints) &&
      result.normalPoints === result.remainingPoints[otherTeam(result.winner)],
    'INVALID_RESULT',
  );
  if (result.kind === 'baglanma')
    requireRule(
      result.remainingPoints[result.winner] < result.normalPoints,
      'INVALID_RESULT',
    );
}
export function getMatchWinner(score: ScoreState): Team | null {
  assertScoreState(score);
  if (score.teams.A.officialScore >= 101) return 'A';
  if (score.teams.B.officialScore >= 101) return 'B';
  return null;
}
export interface ScoringOutcome {
  readonly score: ScoreState;
  readonly awardedPoints: number;
  readonly matchWinner: Team | null;
}
export function applyRoundResult(
  score: ScoreState,
  result: RoundResult,
): ScoringOutcome {
  assertScoreState(score);
  assertRoundResult(result);
  requireRule(getMatchWinner(score) === null, 'INVALID_PHASE');
  const teams: Record<Team, TeamScore> = {
    A: { ...score.teams.A },
    B: { ...score.teams.B },
  };
  if (result.kind === 'seka') {
    const next = {
      teams,
      sekaBank:
        score.sekaBank + result.remainingPoints.A + result.remainingPoints.B,
    };
    assertScoreState(next);
    return freeze({ score: next, awardedPoints: 0, matchWinner: null });
  }
  const winner = teams[result.winner];
  const loser = otherTeam(result.winner);
  if (!teams[loser].isScoreOpened)
    teams[loser] = {
      isScoreOpened: false,
      officialScore: 0,
      pendingOpeningPoints: 0,
    };
  const awardedPoints = result.normalPoints + score.sekaBank;
  requireRule(points(awardedPoints), 'INVALID_SCORE');
  teams[result.winner] =
    winner.isScoreOpened || awardedPoints >= 13
      ? {
          isScoreOpened: true,
          officialScore:
            winner.officialScore + winner.pendingOpeningPoints + awardedPoints,
          pendingOpeningPoints: 0,
        }
      : {
          isScoreOpened: false,
          officialScore: 0,
          pendingOpeningPoints: winner.pendingOpeningPoints + awardedPoints,
        };
  const next = { teams, sekaBank: 0 };
  return freeze({
    score: next,
    awardedPoints,
    matchWinner: getMatchWinner(next),
  });
}
