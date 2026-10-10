import type { ReactNode } from 'react';
import type { GameSnapshot, RoomJoined, RoomSnapshot } from '@domino/protocol';
import { HeldTiles } from './HeldTiles';
import { RevealedTiles } from './RevealedTiles';
import { revealedHand } from '../reveal';
import { TableDecor } from './TableDecor';
import { tableDecorSeed } from './tableDecorData';
import { playerVisuals } from './playerVisuals';

const positions = ['bottom', 'left', 'top', 'right'] as const;

/** Decorative layers use public seat/turn state only. Controls remain in children. */
export function TableScene({
  room,
  own,
  game,
  children,
}: {
  room: RoomSnapshot;
  own: RoomJoined;
  game?: GameSnapshot | null;
  children: ReactNode;
}) {
  return (
    <div className={`lounge-scene ${game ? 'seated-scene' : ''}`}>
      <div
        className={`table-shell physical-table ${game ? '' : 'lobby-table'}`}
      >
        <div className="scene-decoration" aria-hidden="true">
          <TableDecor
            seed={tableDecorSeed(
              room.roomId,
              game?.matchId,
              game?.public.roundNumber,
            )}
          />
          {room.seats.map((player, seat) => {
            const relative = (seat - own.seat + 4) % 4;
            const position = positions[relative]!;
            const revealed = revealedHand(game, seat);
            const active =
              !room.isPaused &&
              game?.public.phase === 'playing' &&
              game.public.turn === seat;
            const visuals = playerVisuals(player);
            const asset =
              position === 'top'
                ? visuals.top
                : visuals.gender === 'female'
                  ? visuals.lobby
                  : `/images/lounge/${relative % 2 === 0 ? 'hands-home-dark' : 'hands-home-linen'}.png`;
            return (
              <div
                key={seat}
                className={`scene-player scene-player--${position} ${active ? 'is-active' : ''}`}
                data-seat={seat}
                data-persona-gender={visuals.gender}
              >
                {player && game && relative !== 0 ? (
                  <div
                    className={`scene-hand scene-hand--${position} holding-hand`}
                  >
                    <HeldTiles
                      count={game.public.handCounts[seat]!}
                      concealed
                      side={position === 'left' || position === 'right'}
                      active={active}
                      gripAsset={visuals.grip}
                      topAsset={visuals.top}
                    >
                      <div className="concealed-hand">
                        {revealed ? (
                          <RevealedTiles hand={revealed} />
                        ) : (
                          Array.from(
                            { length: game.public.handCounts[seat]! },
                            (_, index) => {
                              const offset =
                                index - (game.public.handCounts[seat]! - 1) / 2;
                              return (
                                <span
                                  className="concealed-tile"
                                  key={index}
                                  style={{
                                    rotate: `${offset * 4}deg`,
                                    translate: `0 ${Math.abs(offset) * 1.2}px`,
                                  }}
                                />
                              );
                            },
                          )
                        )}
                      </div>
                    </HeldTiles>
                  </div>
                ) : (
                  player &&
                  !game && (
                    <div className={`scene-hand scene-hand--${position}`}>
                      <picture>
                        <source media="(min-width: 641px)" srcSet={asset} />
                        <img
                          src="/images/lounge/empty.svg"
                          alt=""
                          width="1774"
                          height="887"
                          draggable="false"
                        />
                      </picture>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
        {children}
      </div>
    </div>
  );
}
