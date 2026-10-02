import { assertSeed, nextRandom } from './rng.js';
import type { BotCommand, BotView, Strategy } from './types.js';

export function chooseCommand(
  view: BotView,
  strategy: Strategy,
  rngState: number,
): { readonly command: BotCommand | null; readonly rngState: number } {
  assertSeed(rngState);
  if (strategy !== 'deterministic-first' && strategy !== 'seeded-random')
    throw new RangeError('Unknown bot strategy');
  if (view.legalActions.length === 0)
    return Object.freeze({ command: null, rngState });
  if (strategy === 'deterministic-first')
    return Object.freeze({ command: view.legalActions[0]!, rngState });
  const draw = nextRandom(rngState);
  return Object.freeze({
    command:
      view.legalActions[Math.floor(draw.value * view.legalActions.length)]!,
    rngState: draw.state,
  });
}
