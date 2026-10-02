import {
  createMatch,
  EngineError,
  SEATS,
  startNextRound,
  teamOf,
} from '@domino/game-engine';
import type { Four, MatchState, Seat } from '@domino/game-engine';
import { applyBotCommand, getBotView, roundNumber } from './actions.js';
import { createCoverage, updateCoverage } from './coverage.js';
import {
  hashTranscript,
  SimulationFailure,
  summarizeState,
} from './diagnostics.js';
import type { FailureCode } from './diagnostics.js';
import { freeze } from './immutable.js';
import {
  assertIllegalCommandsRejected,
  assertSimulationState,
  assertSimulationTransition,
  InvariantFailure,
} from './invariants.js';
import { assertSeed, shuffleDeck } from './rng.js';
import { chooseCommand } from './strategy.js';
import type {
  RoundSummary,
  SimulationCommand,
  SimulationOptions,
  SimulationResult,
  Strategy,
  TraceEntry,
} from './types.js';

function strategiesFor(
  option: SimulationOptions['strategies'],
): Four<Strategy> {
  const value = option ?? 'seeded-random';
  const strategies =
    typeof value === 'string' ? [value, value, value, value] : [...value];
  if (
    strategies.length !== 4 ||
    !strategies.every(
      (strategy) =>
        strategy === 'seeded-random' || strategy === 'deterministic-first',
    )
  )
    throw new RangeError(
      'Specify one valid strategy or exactly four seat strategies',
    );
  return Object.freeze(strategies) as Four<Strategy>;
}
export function simulateMatch(options: SimulationOptions): SimulationResult {
  assertSeed(options.seed);
  const strategies = strategiesFor(options.strategies);
  const maxCommands = options.maxCommands ?? 10_000;
  const maxRounds = options.maxRounds ?? 500;
  if (
    ![maxCommands, maxRounds].every(
      (limit) => Number.isSafeInteger(limit) && limit > 0,
    )
  )
    throw new RangeError('Safety limits must be positive safe integers');
  const origin = options.initialState ? 'provided' : 'fresh';
  // Separate streams: strategy draws never perturb subsequent deck shuffles.
  let deckRng = (options.seed ^ 0xa341316c) >>> 0;
  const botRng: [number, number, number, number] = [0, 1, 2, 3].map(
    (seat) => (options.seed ^ Math.imul(seat + 1, 0x9e3779b9)) >>> 0,
  ) as [number, number, number, number];
  const deal = () => {
    const next = shuffleDeck(deckRng);
    deckRng = next.state;
    return next.deck;
  };
  let state = options.initialState ?? createMatch(deal());
  let commandCount = 0;
  let coverage = createCoverage();
  let previousRoundWasSeka =
    state.phase === 'round-ended' && state.result.kind === 'seka';
  const rounds: RoundSummary[] = [];
  const recent: TraceEntry[] = [];
  const trace: TraceEntry[] = [];
  let hash = hashTranscript(
    0x811c9dc5,
    JSON.stringify({
      seed: options.seed,
      strategies,
      origin,
      summary: summarizeState(state),
    }),
  );
  const fail = (
    code: FailureCode,
    command: SimulationCommand | null,
    reason: string,
  ): never => {
    throw new SimulationFailure({
      version: 'domino-simulation-v1',
      code,
      seed: options.seed,
      strategies,
      origin,
      limits: { maxCommands, maxRounds },
      safetyLimitHit: code === 'COMMAND_LIMIT' || code === 'ROUND_LIMIT',
      commandIndex: commandCount + 1,
      roundNumber: roundNumber(state),
      phase: state.phase,
      actingSeat: command && 'seat' in command ? command.seat : null,
      attemptedCommand: command,
      summary: summarizeState(state),
      recentCommands: recent.slice(-8),
      reason,
    });
  };
  const check = <T>(action: () => T, command: SimulationCommand | null): T => {
    try {
      return action();
    } catch (error) {
      return fail(
        error instanceof EngineError ? 'ENGINE_REJECTED' : 'INVARIANT_FAILED',
        command,
        error instanceof EngineError || error instanceof InvariantFailure
          ? error.code
          : 'UNEXPECTED_FAILURE',
      );
    }
  };
  check(() => assertSimulationState(state), null);
  if (roundNumber(state) > maxRounds)
    return fail('ROUND_LIMIT', null, 'INITIAL_ROUND_EXCEEDS_LIMIT');
  while (state.phase !== 'match-finished') {
    let command: SimulationCommand | null = null;
    if (state.phase === 'round-ended') command = { type: 'next-round' };
    else {
      const decisionState = state;
      const seat: Seat =
        decisionState.phase === 'playing'
          ? decisionState.turn
          : SEATS.find((seat) => teamOf(seat) === decisionState.eligibleTeam)!;
      const decision = check(
        () =>
          chooseCommand(
            getBotView(state, seat),
            strategies[seat],
            botRng[seat],
          ),
        null,
      );
      command = decision.command;
      botRng[seat] = decision.rngState;
    }
    if (!command)
      return fail('NO_BOT_ACTION', null, 'NO_ACTION_FOR_ACTIVE_PHASE');
    if (commandCount >= maxCommands)
      fail('COMMAND_LIMIT', command, 'MAX_COMMANDS_REACHED');
    if (
      roundNumber(state) > maxRounds ||
      (command.type === 'next-round' && roundNumber(state) >= maxRounds)
    )
      fail('ROUND_LIMIT', command, 'MAX_ROUNDS_REACHED');
    const before = state;
    const after: MatchState = check(() => {
      assertIllegalCommandsRejected(before);
      const next =
        command.type === 'next-round'
          ? startNextRound(before, deal())
          : applyBotCommand(before, command);
      assertSimulationTransition(before, command, next);
      return next;
    }, command);
    coverage = updateCoverage(
      coverage,
      before,
      command,
      after,
      previousRoundWasSeka,
    );
    commandCount++;
    const entry = freeze({
      commandIndex: commandCount,
      command,
      before: summarizeState(before),
      after: summarizeState(after),
    });
    hash = hashTranscript(hash, JSON.stringify(entry));
    recent.push(entry);
    if (recent.length > 8) recent.shift();
    if (options.recordTrace) trace.push(entry);
    if (
      before.phase === 'playing' &&
      (after.phase === 'round-ended' || after.phase === 'match-finished')
    ) {
      rounds.push(
        freeze({
          roundNumber: after.round.number,
          kind: after.result.kind,
          winner: after.result.kind === 'seka' ? null : after.result.winner,
          awardedPoints: after.awardedPoints,
          score: after.score,
        }),
      );
      previousRoundWasSeka = after.result.kind === 'seka';
    }
    state = after;
  }
  check(() => assertIllegalCommandsRejected(state), null);
  return freeze({
    version: 'domino-simulation-v1',
    seed: options.seed,
    strategies,
    origin,
    winner: state.winner,
    finalScores: {
      A: state.score.teams.A.officialScore,
      B: state.score.teams.B.officialScore,
    },
    score: {
      teams: { A: { ...state.score.teams.A }, B: { ...state.score.teams.B } },
      sekaBank: state.score.sekaBank,
    },
    roundCount: state.round.number,
    roundsCompleted: rounds.length,
    commandCount,
    sekaCount: rounds.filter((round) => round.kind === 'seka').length,
    safetyLimitHit: false,
    transcriptHash: hash.toString(16).padStart(8, '0'),
    coverage,
    rounds,
    ...(options.recordTrace ? { trace } : {}),
  });
}
