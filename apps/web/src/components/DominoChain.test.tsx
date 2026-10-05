import { act, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DominoChain } from './DominoChain';
import type { PublicGame } from '@domino/protocol';
import { gameSnapshotSchema } from '@domino/protocol';

const board: PublicGame['board'] = [];
for (let left = 0; left <= 6; left++)
  for (let right = left; right <= 6; right++)
    board.push(
      gameSnapshotSchema.shape.public.shape.board.element.parse({
        tile: `${left}:${right}`,
        left,
        right,
      }),
    );
afterEach(() => vi.unstubAllGlobals());
it('responds to measured width, keeps logical tile order and disconnects the resize observer', () => {
  let notify!: ResizeObserverCallback;
  const disconnect = vi.fn(),
    observe = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const view = render(<DominoChain board={board} />);
  const list = screen.getByRole('list', {
    name: 'Played tiles, in chain order',
  });
  expect(observe).toHaveBeenCalledWith(list);
  const resize = (width: number) =>
    act(() =>
      notify(
        [{ contentRect: { width } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    );
  resize(300);
  const transforms = () =>
    [...list.querySelectorAll<HTMLElement>('.board-tile')].map(
      (node) => node.style.transform,
    );
  const narrow = transforms();
  expect(narrow.some((value) => value.includes('rotate(90deg)'))).toBe(true);
  expect(narrow.some((value) => value.includes('rotate(180deg)'))).toBe(true);
  resize(1100);
  expect(transforms()).not.toEqual(narrow);
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((node) => node.getAttribute('aria-label')),
  ).toEqual(board.map((piece) => `Played ${piece.left}:${piece.right}`));
  expect(list.querySelectorAll('.domino')).toHaveLength(28);
  expect(list.querySelectorAll('.double')).toHaveLength(7);
  view.rerender(<DominoChain board={[{ tile: '1:2', left: 2, right: 1 }]} />);
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(within(list).getByLabelText('Played 2:1')).toBeVisible();
  expect(transforms()[0]).toContain('rotate(0deg)');
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
