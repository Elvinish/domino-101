import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../index.js';

describe('large deterministic seed batch', () => {
  it.each(Array.from({ length: 10 }, (_, index) => index * 100))(
    'completes seeds %i through the next 99 without invariant failures',
    (firstSeed) => {
      for (let seed = firstSeed; seed < firstSeed + 100; seed++) {
        const result = simulateMatch({ seed });
        expect(result.seed).toBe(seed);
        expect(result.safetyLimitHit).toBe(false);
        expect(result.finalScores[result.winner]).toBeGreaterThanOrEqual(101);
        expect(result.roundCount).toBeLessThanOrEqual(500);
        expect(result.commandCount).toBeLessThanOrEqual(10000);
        expect(result.roundsCompleted).toBe(result.roundCount);
      }
    },
    30000,
  );
  it.each(['deterministic-first', 'mixed'] as const)(
    'completes 32 seeds with %s seat configurations',
    (mode) => {
      for (let seed = 0; seed < 32; seed++) {
        const strategies =
          mode === 'mixed'
            ? ([
                'deterministic-first',
                'seeded-random',
                'deterministic-first',
                'seeded-random',
              ] as const)
            : mode;
        const result = simulateMatch({ seed, strategies });
        expect(result.finalScores[result.winner]).toBeGreaterThanOrEqual(101);
      }
    },
    15000,
  );
});

describe('naturally reached deterministic rule scenarios', () => {
  it('seed 384 completes a many-round match', () => {
    expect(simulateMatch({ seed: 384 }).roundCount).toBeGreaterThanOrEqual(14);
  });
  it('seed 11 accumulates unopened pending points beyond 13 without opening', () => {
    const result = simulateMatch({ seed: 11 });
    expect(result.coverage.pendingAccumulations).toBeGreaterThan(0);
    expect(
      result.rounds.some((round) =>
        Object.values(round.score.teams).some(
          (team) =>
            !team.isScoreOpened &&
            team.pendingOpeningPoints > 13 &&
            team.officialScore === 0,
        ),
      ),
    ).toBe(true);
  });
  it('seed 4 burns pending points when the opponent wins', () => {
    expect(simulateMatch({ seed: 4 }).coverage.pendingBurns).toBeGreaterThan(0);
  });
  it('seed 8 encounters SEKA and claims its bank', () => {
    const result = simulateMatch({ seed: 8 });
    expect(result.sekaCount).toBeGreaterThan(0);
    expect(result.coverage.bankClaims).toBeGreaterThan(0);
    expect(result.score.sekaBank).toBe(0);
  });
  it('seed 386 naturally reaches consecutive SEKA and preserves the starter', () => {
    const result = simulateMatch({ seed: 386, recordTrace: true });
    expect(result.coverage.consecutiveSeka).toBeGreaterThan(0);
    expect(
      result.rounds.some(
        (round, index) =>
          round.kind === 'seka' && result.rounds[index + 1]?.kind === 'seka',
      ),
    ).toBe(true);
    for (const entry of result.trace!) {
      if (
        entry.command.type === 'next-round' &&
        entry.after.phase === 'playing'
      )
        expect(entry.after.starter).toBe(entry.before.starter);
    }
  });
  it('seed 0 opens scores, overshoots 101, chooses explicit ends and handles varied starter hands', () => {
    const result = simulateMatch({ seed: 0 });
    expect(result.finalScores[result.winner]).toBeGreaterThan(101);
    expect(result.coverage.scoreOpenings).toBeGreaterThan(0);
    expect(result.coverage.ambiguousPlacements).toBeGreaterThan(0);
    expect(result.coverage.starterSelections).toBeGreaterThan(0);
    expect(result.coverage.startersWithoutDouble).toBeGreaterThan(0);
    expect(result.coverage.startersWithMultipleDoubles).toBeGreaterThan(0);
  });
});
