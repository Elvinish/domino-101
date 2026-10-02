import { performance } from 'node:perf_hooks';
import {
  simulateMatch,
  SimulationFailure,
} from '../packages/bot-player/dist/index.js';

import type { Strategy } from '../packages/bot-player/dist/index.js';

interface CliOptions {
  seed: number;
  count: number;
  strategy: Strategy;
  maxCommands: number;
  maxRounds: number;
}
function argumentsFor(args: string[]): CliOptions {
  const options: CliOptions = {
    seed: 0,
    count: 1000,
    strategy: 'seeded-random',
    maxCommands: 10000,
    maxRounds: 500,
  };
  const keys: Record<string, keyof CliOptions> = {
    '--seed': 'seed',
    '--count': 'count',
    '--strategy': 'strategy',
    '--max-commands': 'maxCommands',
    '--max-rounds': 'maxRounds',
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]!];
    const value = args[index + 1];
    if (!key || value === undefined || value.startsWith('--'))
      throw new Error(
        'Usage: pnpm simulate [--seed 0] [--count 1000] [--strategy seeded-random|deterministic-first] [--max-commands 10000] [--max-rounds 500]',
      );
    if (key === 'strategy') {
      if (value !== 'seeded-random' && value !== 'deterministic-first')
        throw new Error('Unknown strategy');
      options.strategy = value;
    } else options[key] = Number(value);
  }
  if (
    !Number.isInteger(options.seed) ||
    options.seed < 0 ||
    !Number.isInteger(options.count) ||
    options.count < 1 ||
    options.count > 100000 ||
    options.seed + options.count - 1 > 0xffffffff
  )
    throw new Error('Seed range must fit uint32; count must be 1–100000');
  return options;
}
try {
  const options = argumentsFor(process.argv.slice(2));
  const start = performance.now();
  let commands = 0;
  let rounds = 0;
  let seka = 0;
  let maxRounds = 0;
  const winners = { A: 0, B: 0 };
  const coverage: Record<string, number> = {};
  for (let offset = 0; offset < options.count; offset++) {
    const result = simulateMatch({
      seed: options.seed + offset,
      strategies: options.strategy,
      maxCommands: options.maxCommands,
      maxRounds: options.maxRounds,
    });
    commands += result.commandCount;
    rounds += result.roundCount;
    seka += result.sekaCount;
    maxRounds = Math.max(maxRounds, result.roundCount);
    winners[result.winner]++;
    for (const [key, value] of Object.entries(result.coverage))
      coverage[key] = (coverage[key] ?? 0) + value;
  }
  console.log(
    JSON.stringify(
      {
        version: 'domino-simulation-v1',
        firstSeed: options.seed,
        lastSeed: options.seed + options.count - 1,
        strategy: options.strategy,
        completedMatches: options.count,
        failures: 0,
        commands,
        rounds,
        maxRounds,
        seka,
        winners,
        coverage,
        elapsedMs: Math.round(performance.now() - start),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof SimulationFailure
      ? JSON.stringify(error.diagnostic, null, 2)
      : error instanceof Error
        ? error.message
        : 'Simulation failed',
  );
  process.exitCode = 1;
}
