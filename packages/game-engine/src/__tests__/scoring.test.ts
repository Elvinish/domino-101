import { describe, expect, it } from 'vitest';
import {
  applyRoundResult,
  createDeck,
  createScoreState,
  getMatchWinner,
  isBlocked,
  placeTile,
  remainingTeamPoints,
  resolveBlockedRound,
  scoreHand,
} from '../index.js';
import type { Hands, RoundResult, ScoreState, Team, Tile } from '../index.js';

function win(winner: Team, normalPoints: number): RoundResult {
  return {
    kind: 'normal',
    winner,
    normalPoints,
    remainingPoints:
      winner === 'A' ? { A: 0, B: normalPoints } : { A: normalPoints, B: 0 },
  };
}
const seka = (total: number): RoundResult => ({
  kind: 'seka',
  remainingPoints: { A: total, B: total },
});
function wins(
  team: Team,
  values: readonly number[],
  score = createScoreState(),
): ScoreState {
  return values.reduce(
    (current, value) => applyRoundResult(current, win(team, value)).score,
    score,
  );
}

describe('remaining hand points', () => {
  it.each([
    ['6:6', 12],
    ['4:6', 10],
    ['2:5', 7],
    ['3:3', 6],
    ['0:5', 5],
  ] as const)('scores %s as %i', (tile, points) => {
    expect(scoreHand([tile])).toBe(points);
  });
  it('scores an empty hand as zero', () => {
    expect(scoreHand([])).toBe(0);
  });
  it('scores a sole 0:0 as ten', () => {
    expect(scoreHand(['0:0'])).toBe(10);
  });
  it.each(createDeck().filter((tile) => tile !== '0:0'))(
    'scores 0:0 as zero alongside %s in either order',
    (tile) => {
      const normal = Number(tile[0]) + Number(tile[2]);
      expect(scoreHand(['0:0', tile])).toBe(normal);
      expect(scoreHand([tile, '0:0'])).toBe(normal);
    },
  );
  it('does not apply a team-wide sole-tile condition', () => {
    expect(remainingTeamPoints([['0:0'], ['1:2'], ['6:6'], ['4:5']])).toEqual({
      A: 22,
      B: 12,
    });
    expect(remainingTeamPoints([['0:0', '6:6'], ['1:2'], [], ['4:5']])).toEqual(
      { A: 12, B: 12 },
    );
  });
  it('makes the special ten appear only when the other tile leaves that hand', () => {
    expect(scoreHand(['0:0', '0:1'])).toBe(1);
    expect(scoreHand(['0:0'])).toBe(10);
    expect(scoreHand([])).toBe(0);
  });
  it('rejects duplicate or malformed hand tiles', () => {
    expect(() => scoreHand(['0:0', '0:0'])).toThrow('INVALID_HANDS');
    expect(() => scoreHand(['6:1' as Tile])).toThrow('INVALID_HANDS');
  });
});

describe('opening score and pending points', () => {
  it('starts each team unopened and all counters at zero', () => {
    expect(createScoreState()).toEqual({
      teams: {
        A: { isScoreOpened: false, officialScore: 0, pendingOpeningPoints: 0 },
        B: { isScoreOpened: false, officialScore: 0, pendingOpeningPoints: 0 },
      },
      sekaBank: 0,
    });
  });
  it('accumulates 7+8+12 without opening even though the pending sum exceeds 13', () => {
    let score = createScoreState();
    for (const [points, pending] of [
      [7, 7],
      [8, 15],
      [12, 27],
    ] as const) {
      score = wins('A', [points], score);
      expect(score.teams.A).toEqual({
        isScoreOpened: false,
        officialScore: 0,
        pendingOpeningPoints: pending,
      });
    }
  });
  it('opens with a single 15-point round and credits all 27 pending points', () => {
    expect(wins('A', [7, 8, 12, 15]).teams.A).toEqual({
      isScoreOpened: true,
      officialScore: 42,
      pendingOpeningPoints: 0,
    });
  });
  it('opens at exactly 13, but not at 12', () => {
    expect(wins('A', [12]).teams.A.isScoreOpened).toBe(false);
    expect(wins('A', [13]).teams.A).toEqual({
      isScoreOpened: true,
      officialScore: 13,
      pendingOpeningPoints: 0,
    });
  });
  it('burns pending points on an opponent win without transfer or SEKA deposit', () => {
    const score = wins('B', [5], wins('A', [7, 8, 12]));
    expect(score.teams.A.pendingOpeningPoints).toBe(0);
    expect(score.teams.B).toEqual({
      isScoreOpened: false,
      officialScore: 0,
      pendingOpeningPoints: 5,
    });
    expect(score.sekaBank).toBe(0);
  });
  it('even a zero-point opponent win burns pending points', () => {
    expect(wins('B', [0], wins('A', [7])).teams.A.pendingOpeningPoints).toBe(0);
  });
  it('keeps opening status independent and preserves already official points', () => {
    const a = wins('A', [15]);
    const bPending = wins('B', [7], a);
    expect(bPending.teams.A).toEqual(a.teams.A);
    expect(bPending.teams.B.isScoreOpened).toBe(false);
    const bOpen = wins('B', [13], bPending);
    expect(bOpen.teams.B.officialScore).toBe(20);
    expect(bOpen.teams.A.officialScore).toBe(15);
    expect(bOpen.teams.A.isScoreOpened).toBe(true);
  });
  it('adds sub-13 points directly once opened', () => {
    expect(wins('A', [7, 8, 12, 15, 5]).teams.A.officialScore).toBe(47);
  });
  it('does not mutate or freeze caller-owned scoring inputs', () => {
    const initial: ScoreState = {
      teams: {
        A: { isScoreOpened: false, officialScore: 0, pendingOpeningPoints: 0 },
        B: { isScoreOpened: false, officialScore: 0, pendingOpeningPoints: 0 },
      },
      sekaBank: 0,
    };
    const result = win('A', 15);
    const next = applyRoundResult(initial, result);
    expect(initial.teams.A.officialScore).toBe(0);
    expect(Object.isFrozen(initial.teams.A)).toBe(false);
    expect(Object.isFrozen(result.remainingPoints)).toBe(false);
    expect(Object.isFrozen(next.score.teams.A)).toBe(true);
  });
});

describe('bağlanma and SEKA', () => {
  const board = placeTile([], '6:6');
  const blocked: Hands = [['3:5'], ['5:5'], ['4:5'], ['3:4', '4:4']];
  it('ends as blocked only if no hand can play', () => {
    expect(isBlocked(board, blocked)).toBe(true);
    expect(isBlocked([], blocked)).toBe(false);
    expect(isBlocked(board, [[], blocked[1], blocked[2], blocked[3]])).toBe(
      false,
    );
    for (const seat of [0, 1, 2, 3] as const) {
      const hands: [Tile[], Tile[], Tile[], Tile[]] = [
        [...blocked[0]],
        [...blocked[1]],
        [...blocked[2]],
        [...blocked[3]],
      ];
      hands[seat].push('1:6');
      expect(isBlocked(board, hands)).toBe(false);
      expect(() => resolveBlockedRound(board, hands)).toThrow('NOT_BLOCKED');
    }
  });
  it('A=17 versus B=25 awards A the losing total 25, not the difference or sum', () => {
    expect(resolveBlockedRound(board, blocked)).toEqual({
      kind: 'baglanma',
      winner: 'A',
      normalPoints: 25,
      remainingPoints: { A: 17, B: 25 },
    });
  });
  it('also handles B winning the lower-total comparison', () => {
    expect(
      resolveBlockedRound(board, [
        blocked[1],
        blocked[0],
        blocked[3],
        blocked[2],
      ]),
    ).toMatchObject({ winner: 'B', normalPoints: 25 });
  });
  it('applies the sole 0:0 bonus before deciding the lower team', () => {
    const result = resolveBlockedRound(board, [
      ['0:0'],
      ['1:2'],
      ['0:1'],
      ['0:2'],
    ]);
    expect(result).toMatchObject({
      kind: 'baglanma',
      winner: 'B',
      normalPoints: 11,
      remainingPoints: { A: 11, B: 5 },
    });
  });
  it('uses the same pending/opening rules for a blocked-round win', () => {
    const result = resolveBlockedRound(board, [
      ['0:0'],
      ['1:2'],
      ['0:1'],
      ['0:2'],
    ]);
    expect(applyRoundResult(createScoreState(), result).score.teams.B).toEqual({
      isScoreOpened: false,
      officialScore: 0,
      pendingOpeningPoints: 11,
    });
  });
  it('equal totals 12:12 create a SEKA and add both totals', () => {
    const result = resolveBlockedRound(board, [
      ['1:5'],
      ['3:3'],
      ['2:4'],
      ['0:1', '2:3'],
    ]);
    expect(result).toEqual({ kind: 'seka', remainingPoints: { A: 12, B: 12 } });
    expect(applyRoundResult(createScoreState(), result)).toMatchObject({
      score: { sekaBank: 24 },
      awardedPoints: 0,
      matchWinner: null,
    });
  });
  it('SEKA neither opens a team nor burns its pending points', () => {
    const before = wins('A', [7, 8]);
    const after = applyRoundResult(before, seka(25));
    expect(after.score.teams).toEqual(before.teams);
    expect(after.score.sekaBank).toBe(50);
    expect(after.awardedPoints).toBe(0);
  });
  it('consecutive SEKA adds 50+20, then the next winner gets normal points+70 once', () => {
    const first = applyRoundResult(createScoreState(), seka(25)).score;
    const second = applyRoundResult(first, seka(10)).score;
    expect(second.sekaBank).toBe(70);
    const claimed = applyRoundResult(second, win('B', 15));
    expect(claimed.awardedPoints).toBe(85);
    expect(claimed.score.teams.B.officialScore).toBe(85);
    expect(claimed.score.sekaBank).toBe(0);
    expect(wins('B', [5], claimed.score).teams.B.officialScore).toBe(90);
  });
  it('effective round value including SEKA can open a team', () => {
    const score = applyRoundResult(wins('A', [7]), seka(5)).score;
    const next = applyRoundResult(score, win('A', 3));
    expect(next.awardedPoints).toBe(13);
    expect(next.score.teams.A.officialScore).toBe(20);
  });
  it('a small SEKA payout may remain pending rather than opening', () => {
    const score = applyRoundResult(createScoreState(), seka(2)).score;
    const next = applyRoundResult(score, win('A', 3));
    expect(next.score.teams.A).toEqual({
      isScoreOpened: false,
      officialScore: 0,
      pendingOpeningPoints: 7,
    });
    expect(next.score.sekaBank).toBe(0);
  });
  it('claims SEKA after a blocked win, burns opponent pending, and never transfers it', () => {
    const score = applyRoundResult(wins('B', [7, 8]), seka(12)).score;
    const next = applyRoundResult(score, resolveBlockedRound(board, blocked));
    expect(next.score.teams.A.officialScore).toBe(49);
    expect(next.score.teams.B.pendingOpeningPoints).toBe(0);
    expect(next.score.sekaBank).toBe(0);
  });
});

describe('match threshold and invalid score states', () => {
  it.each([101, 105])('wins at official score %i', (total) => {
    const before = wins('A', [98]);
    const after = applyRoundResult(before, win('A', total - 98));
    expect(after.matchWinner).toBe('A');
    expect(after.score.teams.A.officialScore).toBe(total);
    expect(() => applyRoundResult(after.score, win('B', 13))).toThrow(
      'INVALID_PHASE',
    );
  });
  it('does not declare victory at 100 or from more than 101 pending points', () => {
    expect(getMatchWinner(wins('B', [100]))).toBeNull();
    expect(getMatchWinner(wins('A', Array<number>(10).fill(12)))).toBeNull();
  });
  it('can finish the match by claiming the SEKA bank', () => {
    const before = applyRoundResult(wins('B', [90]), seka(5)).score;
    expect(applyRoundResult(before, win('B', 1)).matchWinner).toBe('B');
  });
  it.each([-1, NaN, Infinity, 0.5])(
    'rejects invalid SEKA counter %s',
    (sekaBank) => {
      expect(() =>
        applyRoundResult({ ...createScoreState(), sekaBank }, win('A', 15)),
      ).toThrow('INVALID_SCORE');
    },
  );
  it('rejects overflow, unequal SEKA, and incorrect loser totals', () => {
    expect(() =>
      applyRoundResult(
        { ...createScoreState(), sekaBank: Number.MAX_SAFE_INTEGER },
        seka(1),
      ),
    ).toThrow('INVALID_SCORE');
    expect(() =>
      applyRoundResult(createScoreState(), {
        kind: 'seka',
        remainingPoints: { A: 12, B: 13 },
      }),
    ).toThrow('INVALID_RESULT');
    expect(() =>
      applyRoundResult(createScoreState(), {
        kind: 'baglanma',
        winner: 'A',
        normalPoints: 8,
        remainingPoints: { A: 17, B: 25 },
      }),
    ).toThrow('INVALID_RESULT');
    expect(() =>
      applyRoundResult(createScoreState(), {
        kind: 'baglanma',
        winner: 'B',
        normalPoints: 17,
        remainingPoints: { A: 17, B: 25 },
      }),
    ).toThrow('INVALID_RESULT');
  });
  it('rejects inconsistent opened and unopened counters', () => {
    const initial = createScoreState();
    expect(() =>
      getMatchWinner({
        ...initial,
        teams: {
          ...initial.teams,
          A: {
            isScoreOpened: false,
            officialScore: 7,
            pendingOpeningPoints: 1,
          },
        },
      } as unknown as ScoreState),
    ).toThrow('INVALID_SCORE');
    expect(() =>
      getMatchWinner({
        ...initial,
        teams: {
          ...initial.teams,
          A: {
            isScoreOpened: true,
            officialScore: 20,
            pendingOpeningPoints: 1,
          },
        },
      } as unknown as ScoreState),
    ).toThrow('INVALID_SCORE');
  });
});
