import type { ReactNode } from 'react';

/** Two independently anchored photo halves follow the edges of the tile row.
 * The same photo is clipped again above the row to put only thumbs in front. */
export function HeldTiles({
  children,
  count,
  concealed = false,
  side = false,
  active = false,
  gripAsset = '/images/lounge/hands-grip.png',
  topAsset = '/images/lounge/player-top-male.png',
}: {
  children: ReactNode;
  count: number;
  concealed?: boolean;
  side?: boolean;
  active?: boolean;
  gripAsset?: string;
  topAsset?: string;
}) {
  const across = concealed && !side;
  const asset = across ? topAsset : gripAsset;
  return (
    <div
      className={`held-set ${concealed ? 'remote-grip' : 'local-grip'} ${side ? 'side-grip' : ''} ${across ? 'across-grip' : ''} ${active ? 'is-active' : ''} ${count === 0 ? 'is-empty' : ''}`}
    >
      {across && (
        <picture className="player-torso" aria-hidden="true">
          <source media="(min-width: 641px)" srcSet={asset} />
          <img
            src="/images/lounge/empty.svg"
            alt=""
            width="1280"
            height="1280"
            draggable="false"
          />
        </picture>
      )}
      {(['back', 'front'] as const).map((layer) => (
        <div
          className={`grip-layer grip-layer--${layer}`}
          key={layer}
          aria-hidden="true"
        >
          {(['left', 'right'] as const).map((half) => (
            <picture className={`grip-photo grip-photo--${half}`} key={half}>
              <source media="(min-width: 641px)" srcSet={asset} />
              <img
                src="/images/lounge/empty.svg"
                alt=""
                width="1536"
                height="1024"
                draggable="false"
              />
            </picture>
          ))}
        </div>
      ))}
      {children}
    </div>
  );
}
