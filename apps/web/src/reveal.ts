import type { GameSnapshot } from '@domino/protocol';

export function revealedHand(
  game: GameSnapshot | null | undefined,
  seat: number,
) {
  return game &&
    (game.public.phase === 'round-ended' ||
      game.public.phase === 'match-finished')
    ? game.public.revealedHands?.[seat]
    : undefined;
}
