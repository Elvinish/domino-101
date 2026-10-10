import { Domino } from './Domino';

/** Uses only the server's explicit end-of-round reveal. */
export function RevealedTiles({ hand }: { hand: readonly string[] }) {
  return hand.map((tile, index) => {
    const [left, right] = tile.split(':').map(Number);
    const offset = index - (hand.length - 1) / 2;
    return (
      <span
        className="revealed-tile"
        key={tile}
        role="img"
        aria-label={tile}
        style={{
          rotate: `${offset * 4}deg`,
          translate: `0 ${Math.abs(offset) * 1.2}px`,
        }}
      >
        <Domino left={left!} right={right!} />
      </span>
    );
  });
}
