import { useLayoutEffect, useRef, useState } from 'react';
import type { PublicGame } from '@domino/protocol';
import { layoutChain } from '../board/layout';
import { useI18n } from '../i18n';
import { Domino } from './Domino';

export function DominoChain({ board }: { board: PublicGame['board'] }) {
  const { t } = useI18n();
  const container = useRef<HTMLOListElement>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = layoutChain(board, width);
  return (
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
              <Domino left={piece.left} right={piece.right} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
