import { useLayoutEffect, useRef, useState } from 'react';
import type { PublicGame } from '@domino/protocol';
import { layoutChain } from '../board/layout';
import { useI18n } from '../i18n';
import { Domino } from './Domino';

export function DominoChain({
  board,
  motionScope = '',
  motionEnabled = true,
}: {
  board: PublicGame['board'];
  motionScope?: string;
  motionEnabled?: boolean;
}) {
  const { t } = useI18n();
  const container = useRef<HTMLOListElement>(null);
  const space = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 320, height: 320 });
  const hasTiles = board.length > 0;
  const previous = useRef<{
    tiles: Set<string>;
    scope: string;
    enabled: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const baseline = previous.current;
    const tiles = new Set<string>(board.map((piece) => piece.tile));
    previous.current = { tiles, scope: motionScope, enabled: motionEnabled };
    // A restored board, new round or bulk catch-up is a baseline, just as it is
    // for placement audio. Only a single new authoritative tile settles in.
    if (
      !baseline ||
      !baseline.enabled ||
      !motionEnabled ||
      baseline.scope !== motionScope ||
      tiles.size !== baseline.tiles.size + 1 ||
      [...baseline.tiles].some((tile) => !tiles.has(tile))
    )
      return;
    const added = board.find((piece) => !baseline.tiles.has(piece.tile));
    const element = container.current?.querySelector(
      `[data-tile="${added?.tile}"] .board-placement`,
    );
    element?.classList.add('is-arriving');
    return () => element?.classList.remove('is-arriving');
  }, [board, motionScope, motionEnabled]);
  useLayoutEffect(() => {
    const element = space.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0) return;
      // The phone grid allocates a fixed play area. Desktop retains its existing
      // intrinsic-height layout; observing it must not cause a resize loop.
      const constrained =
        getComputedStyle(element)
          .getPropertyValue('--chain-fit-height')
          .trim() === '1';
      const height = constrained ? Math.max(1, entry.contentRect.height) : 320;
      setArea((previous) =>
        previous.width === entry.contentRect.width && previous.height === height
          ? previous
          : { width: entry.contentRect.width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = layoutChain(board, area.width, area.height);
  return (
    <div ref={space} className="chain-space">
      {hasTiles && (
        <ol
          ref={container}
          className="board"
          aria-label={t('game.boardLabel')}
          style={{ height: layout.height }}
        >
          {board.map((piece, index) => {
            const tile = layout.tiles[index]!;
            return (
              <li
                key={piece.tile}
                data-tile={piece.tile}
                aria-label={t('game.played', {
                  tile: `${piece.left}:${piece.right}`,
                })}
                style={{
                  left: tile.x * layout.scale,
                  top: tile.y * layout.scale,
                  width: tile.width * layout.scale,
                  height: tile.height * layout.scale,
                }}
              >
                <span
                  className="board-tile"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${tile.rotation}deg) scale(${layout.scale})`,
                  }}
                >
                  <span className="board-placement">
                    <Domino left={piece.left} right={piece.right} />
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
