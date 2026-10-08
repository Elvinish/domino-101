import type { ReactNode } from 'react';
import type { GameSnapshot, RoomJoined, RoomSnapshot } from '@domino/protocol';

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
    <div className="lounge-scene">
      <div
        className={`table-shell physical-table ${game ? '' : 'lobby-table'}`}
      >
        <div className="scene-decoration" aria-hidden="true">
          {room.seats.map((player, seat) => {
            const relative = (seat - own.seat + 4) % 4;
            const position = positions[relative]!;
            const active =
              !room.isPaused &&
              game?.public.phase === 'playing' &&
              game.public.turn === seat;
            const asset =
              relative % 2 === 0 ? 'hands-home-dark' : 'hands-home-linen';
            return (
              <div
                key={seat}
                className={`scene-player scene-player--${position} ${active ? 'is-active' : ''}`}
                data-seat={seat}
              >
                {player && (
                  <div className={`scene-hand scene-hand--${position}`}>
                    <picture>
                      <source
                        media="(min-width: 641px)"
                        srcSet={`/images/lounge/${asset}.png`}
                      />
                      <img
                        src="/images/lounge/empty.svg"
                        alt=""
                        width="1774"
                        height="887"
                        draggable="false"
                      />
                    </picture>
                    {game && relative !== 0 && (
                      <div className="concealed-hand">
                        {Array.from(
                          { length: game.public.handCounts[seat]! },
                          (_, index) => (
                            <span className="concealed-tile" key={index} />
                          ),
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <img
            className="scene-prop scene-prop--glass"
            src="/images/lounge/drink.svg"
            alt=""
            width="120"
            height="120"
            draggable="false"
          />
          <div className="scene-coffee">
            <img
              className="scene-prop"
              src="/images/lounge/coffee.svg"
              alt=""
              width="120"
              height="120"
              draggable="false"
            />
            <svg className="scene-smoke" viewBox="0 0 70 140" focusable="false">
              <path d="M39 134c-14-22 20-27 6-47S29 54 44 36s8-25 1-32" />
              <path d="M42 132c16-22-6-24-1-44s18-29 6-43" />
              <path d="M36 132c-8-16 9-24 3-36" />
            </svg>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
