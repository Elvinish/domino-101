import { useEffect, useMemo, useState } from 'react';
import type { SeatDecor, TableProp } from './tableDecorData';
import { selectTableDecor } from './tableDecorData';

import { TablePropArt } from './TablePropArt';

function VisualProp({ prop }: { prop: TableProp }) {
  return (
    <span
      className={`table-prop table-prop--${prop.visual} ${prop.motion ? `table-prop--${prop.motion}` : ''}`}
      data-prop-id={prop.id}
      title={prop.label}
    >
      <TablePropArt prop={prop} />
      {prop.motion === 'steam' && (
        <span className="table-prop-vapor" aria-hidden="true" />
      )}
      {prop.motion === 'smoke' && (
        <span
          className="table-prop-vapor table-prop-vapor--smoke"
          aria-hidden="true"
        />
      )}
    </span>
  );
}

function DecorSet({
  decor,
  leaving = false,
}: {
  decor: SeatDecor;
  leaving?: boolean;
}) {
  return (
    <div
      className={`table-decor-seat table-decor-seat--${decor.seat} ${leaving ? 'is-leaving' : 'is-arriving'}`}
    >
      {decor.props.map((prop) => (
        <VisualProp key={prop.id} prop={prop} />
      ))}
    </div>
  );
}

export function TableDecor({ seed }: { seed: string }) {
  const current = useMemo(() => selectTableDecor(seed), [seed]);
  const [transition, setTransition] = useState<{
    seed: string;
    previous: string | null;
  }>({ seed, previous: null });
  if (transition.seed !== seed) {
    setTransition({ seed, previous: transition.seed });
  }
  const leaving = useMemo(
    () => (transition.previous ? selectTableDecor(transition.previous) : null),
    [transition.previous],
  );
  useEffect(() => {
    if (!transition.previous) return;
    const timer = window.setTimeout(() => {
      setTransition((value) => ({ ...value, previous: null }));
    }, 560);
    return () => window.clearTimeout(timer);
  }, [transition]);
  return (
    <div className="table-decor" aria-hidden="true" data-decor-seed={seed}>
      {leaving?.map((decor) => (
        <DecorSet
          key={`${transition.previous}-${decor.seat}`}
          decor={decor}
          leaving
        />
      ))}
      {current.map((decor) => (
        <DecorSet key={`${seed}-${decor.seat}`} decor={decor} />
      ))}
    </div>
  );
}
