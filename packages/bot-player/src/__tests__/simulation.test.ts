import { describe, expect, it } from 'vitest';
import { createDeck, createMatch } from '@domino/game-engine';
import type { Four } from '@domino/game-engine';
import { simulateMatch, SimulationFailure } from '../index.js';
import type { SimulationOptions, Strategy } from '../index.js';

function failure(options: SimulationOptions): SimulationFailure {
  try {
    simulateMatch(options);
  } catch (error) {
    if (error instanceof SimulationFailure) return error;
    throw error;
  }
  throw new Error('Expected simulation failure');
}
describe('full deterministic match simulation', () => {
  it.each(['deterministic-first', 'seeded-random'] as const)(
    'completes a full match with %s',
    (strategy) => {
      const result = simulateMatch({ seed: 123, strategies: strategy });
      expect(result.finalScores[result.winner]).toBeGreaterThanOrEqual(101);
      expect(result.roundCount).toBeGreaterThan(1);
      expect(result.roundsCompleted).toBe(result.roundCount);
      expect(result.commandCount).toBeGreaterThan(28);
      expect(result.safetyLimitHit).toBe(false);
      expect(result).not.toHaveProperty('trace');
      expect(result).not.toHaveProperty('hands');
      expect(Object.isFrozen(result.score.teams.A)).toBe(true);
    },
  );
  it.each([0, 8, 42, 0xffffffff])(
    'exactly replays every recorded command and result for seed %i',
    (seed) => {
      const options = { seed, recordTrace: true };
      const first = simulateMatch(options);
      expect(first).toEqual(simulateMatch(options));
      expect(first.trace).toHaveLength(first.commandCount);
      expect(first.trace!.at(-1)!.after.phase).toBe('match-finished');
      expect(
        first
          .trace!.slice(0, -1)
          .every((entry) => entry.before.phase !== 'match-finished'),
      ).toBe(true);
    },
  );
  it('different seeds change the transcript', () => {
    expect(simulateMatch({ seed: 0 }).transcriptHash).not.toBe(
      simulateMatch({ seed: 1 }).transcriptHash,
    );
  });
  it('supports mixed strategies with reproducible independent seat streams', () => {
    const strategies: Four<Strategy> = [
      'deterministic-first',
      'seeded-random',
      'seeded-random',
      'deterministic-first',
    ];
    const options = { seed: 42, strategies, recordTrace: true };
    expect(simulateMatch(options)).toEqual(simulateMatch(options));
    expect(Object.isFrozen(strategies)).toBe(false);
  });
  it('supports the same supplied engine-created initial state without mutation', () => {
    const initialState = createMatch(createDeck());
    const before = JSON.stringify(initialState);
    const options = { seed: 22, initialState, recordTrace: true };
    const first = simulateMatch(options);
    expect(first.origin).toBe('provided');
    expect(first).toEqual(simulateMatch(options));
    expect(JSON.stringify(initialState)).toBe(before);
  });
  it('trace recording does not alter decisions or RNG consumption', () => {
    const { trace, ...withTrace } = simulateMatch({
      seed: 42,
      recordTrace: true,
    });
    expect(trace!.length).toBeGreaterThan(0);
    expect(withTrace).toEqual(simulateMatch({ seed: 42 }));
  });
});
describe('safety limits and practical diagnostics', () => {
  it('fails with a reproducible attempted command at the command limit', () => {
    const options = { seed: 1, maxCommands: 1 };
    const error = failure(options);
    expect(error.diagnostic).toMatchObject({
      seed: 1,
      code: 'COMMAND_LIMIT',
      safetyLimitHit: true,
      commandIndex: 2,
      roundNumber: 1,
      phase: 'playing',
      origin: 'fresh',
    });
    expect(error.diagnostic.attemptedCommand).not.toBeNull();
    expect(error.diagnostic.actingSeat).not.toBeNull();
    expect(error.diagnostic.recentCommands).toHaveLength(1);
    expect(error.diagnostic).toEqual(failure(options).diagnostic);
  });
  it('fails before dealing a round beyond the round limit', () => {
    const error = failure({ seed: 0, maxRounds: 1 });
    expect(error.diagnostic).toMatchObject({
      code: 'ROUND_LIMIT',
      roundNumber: 1,
      phase: 'round-ended',
      attemptedCommand: { type: 'next-round' },
      actingSeat: null,
    });
    expect(error.diagnostic.recentCommands).toHaveLength(8);
  });
  it('does not dump decks, hidden hands, or unbounded state into diagnostics', () => {
    const error = failure({ seed: 0, maxCommands: 30 });
    const text = error.message;
    expect(text.length).toBeLessThan(20000);
    expect(text).not.toContain('"hands"');
    expect(text).not.toContain('"hand"');
    expect(text).not.toContain('"deck"');
    expect(text).not.toContain('"board"');
    expect(error.diagnostic.recentCommands.length).toBeLessThanOrEqual(8);
    expect(Object.isFrozen(error.diagnostic.summary.score)).toBe(true);
  });
  it('allows completion exactly at the command/round limits', () => {
    const first = simulateMatch({ seed: 42 });
    expect(
      simulateMatch({
        seed: 42,
        maxCommands: first.commandCount,
        maxRounds: first.roundCount,
      }),
    ).toEqual(first);
  });
  it.each([0, -1, 1.5, Infinity, NaN])(
    'rejects invalid safety limit %s before execution',
    (limit) => {
      expect(() => simulateMatch({ seed: 0, maxCommands: limit })).toThrow(
        RangeError,
      );
      expect(() => simulateMatch({ seed: 0, maxRounds: limit })).toThrow(
        RangeError,
      );
    },
  );
  it('rejects invalid configuration before simulation', () => {
    expect(() => simulateMatch({ seed: -1 })).toThrow(RangeError);
    expect(() =>
      simulateMatch({
        seed: 0,
        strategies: ['seeded-random'] as unknown as Four<Strategy>,
      }),
    ).toThrow(RangeError);
    expect(() =>
      simulateMatch({ seed: 0, strategies: 'unknown' as Strategy }),
    ).toThrow(RangeError);
  });
});
