import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TableDecor } from './TableDecor';
import {
  DECOR_COMBOS,
  DECOR_SEATS,
  TABLE_PROPS,
  selectTableDecor,
  tableDecorSeed,
} from './tableDecorData';

describe('seeded tabletop decoration', () => {
  it('ships a broad item pool and ready-made natural combinations', () => {
    expect(TABLE_PROPS.length).toBeGreaterThanOrEqual(50);
    expect(DECOR_COMBOS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(TABLE_PROPS.map((prop) => prop.id)).size).toBe(
      TABLE_PROPS.length,
    );
    expect(
      DECOR_COMBOS.every(
        (combo) => combo.items.length >= 2 && combo.items.length <= 3,
      ),
    ).toBe(true);
  });

  it('is stable for the same room/match/round and seat order', () => {
    const seed = tableDecorSeed(
      'a'.repeat(32),
      '10000000-0000-4000-8000-000000000000',
      2,
    );
    const first = selectTableDecor(seed);
    expect(selectTableDecor(seed)).toEqual(first);
    expect(first.map((entry) => entry.seat)).toEqual([...DECOR_SEATS]);
    expect(
      first.every(
        (entry) => entry.props.length >= 2 && entry.props.length <= 3,
      ),
    ).toBe(true);
    expect(new Set(first.map((entry) => entry.combo.id)).size).toBe(
      DECOR_SEATS.length,
    );
  });

  it('changes with a new round, keeps seats independent, and does not depend on rerender', () => {
    const room = 'b'.repeat(32);
    const roundOne = selectTableDecor(tableDecorSeed(room, 'match', 1));
    const roundTwo = selectTableDecor(tableDecorSeed(room, 'match', 2));
    expect(roundTwo).not.toEqual(roundOne);
    expect(
      new Set(roundOne.flatMap((entry) => entry.props.map((prop) => prop.id)))
        .size,
    ).toBeGreaterThan(2);
    expect(new Set(roundOne.map((entry) => entry.combo.id)).size).toBe(
      DECOR_SEATS.length,
    );
  });

  it('keeps selection independent from the game state and reconnect identity', () => {
    const seed = tableDecorSeed('c'.repeat(32), 'match', 4);
    expect(selectTableDecor(seed)).toEqual(selectTableDecor(seed));
    expect(
      selectTableDecor(tableDecorSeed('c'.repeat(32), 'other-match', 4)),
    ).not.toEqual(selectTableDecor(seed));
  });

  it('keeps the same rendered props when React rerenders with the same seed', () => {
    const seed = tableDecorSeed('d'.repeat(32), 'match', 3);
    const view = render(<TableDecor seed={seed} />);
    const props = () =>
      Array.from(view.container.querySelectorAll('[data-prop-id]')).map(
        (element) => element.getAttribute('data-prop-id'),
      );
    const first = props();
    view.rerender(<TableDecor seed={seed} />);
    expect(props()).toEqual(first);
  });

  it('crossfades only seed changes and removes outgoing props, including rapid round changes', () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <StrictMode>
          <TableDecor seed="round-1" />
        </StrictMode>,
      );
      const firstProp = view.container.querySelector('[data-prop-id]');
      view.rerender(
        <StrictMode>
          <TableDecor seed="round-1" />
        </StrictMode>,
      );
      expect(view.container.querySelector('[data-prop-id]')).toBe(firstProp);
      view.rerender(
        <StrictMode>
          <TableDecor seed="round-2" />
        </StrictMode>,
      );
      expect(view.container.querySelectorAll('.is-leaving')).toHaveLength(4);
      act(() => vi.advanceTimersByTime(250));
      view.rerender(
        <StrictMode>
          <TableDecor seed="round-3" />
        </StrictMode>,
      );
      expect(view.container.querySelectorAll('.is-arriving')).toHaveLength(4);
      act(() => vi.advanceTimersByTime(560));
      expect(view.container.querySelectorAll('.is-leaving')).toHaveLength(0);
      expect(view.container.querySelectorAll('.table-decor-seat')).toHaveLength(
        4,
      );
      expect(view.container.querySelector('.table-decor')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
