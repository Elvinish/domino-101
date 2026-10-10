import { expect, type Page } from '@playwright/test';

/** Check sleeve roots, not the much wider transparent PNG bounding boxes. */
export async function expectHandsReachSceneEdges(page: Page) {
  expect(
    await page.locator('.seated-scene').evaluate((scene) => scene.scrollLeft),
    'Focusing controls must not pan the scene into decorative overflow',
  ).toBe(0);
  const roots = await page.locator('.seated-scene').evaluate((scene) => {
    const boundary = scene.getBoundingClientRect();
    return Array.from(scene.querySelectorAll<HTMLElement>('.held-set'))
      .filter((set) => !set.classList.contains('is-empty'))
      .flatMap((set) => {
        const anchor = set.closest<HTMLElement>('.holding-hand');
        const position = anchor?.classList.contains('scene-hand--left')
          ? 'left'
          : anchor?.classList.contains('scene-hand--right')
            ? 'right'
            : anchor
              ? 'top'
              : 'bottom';
        const box = (anchor ?? set).getBoundingClientRect();
        const matrix = new DOMMatrixReadOnly(
          getComputedStyle(anchor ?? set).transform,
        );
        return Array.from(
          set.querySelectorAll<HTMLElement>('.grip-layer--back .grip-photo'),
        ).map((photo) => {
          const style = getComputedStyle(photo);
          const width = parseFloat(style.width);
          const left = photo.classList.contains('grip-photo--left');
          const x =
            (left
              ? parseFloat(style.left) + width * 0.18
              : set.offsetWidth - parseFloat(style.right) - width * 0.18) -
            set.offsetWidth / 2;
          const y =
            parseFloat(style.top) -
            set.offsetHeight / 2 +
            (anchor
              ? set.classList.contains('side-grip')
                ? parseFloat(style.height)
                : 0
              : parseFloat(style.height) +
                parseFloat(getComputedStyle(photo, '::before').height) -
                20);
          const rootX = box.left + box.width / 2 + matrix.a * x + matrix.c * y;
          const rootY = box.top + box.height / 2 + matrix.b * x + matrix.d * y;
          return {
            position,
            reachesEdge:
              position === 'left'
                ? rootX <= boundary.left
                : position === 'right'
                  ? rootX >= boundary.right
                  : position === 'top'
                    ? rootY <= boundary.top
                    : rootY >= boundary.bottom,
          };
        });
      });
  });
  expect(roots.length).toBeGreaterThan(0);
  for (const root of roots)
    expect(
      root.reachesEdge,
      `${root.position} sleeve continues off scene`,
    ).toBe(true);
  const seats = await page.locator('.physical-table').evaluate((table) => {
    const bounds = table.getBoundingClientRect();
    const board = table.querySelector('.board')?.getBoundingClientRect();
    return ['left', 'right'].map((side) => {
      const hand = table
        .querySelector(`.scene-hand--${side}`)!
        .getBoundingClientRect();
      const card = table
        .querySelector(`.seat-${side}`)!
        .getBoundingClientRect();
      return {
        side,
        centered:
          Math.abs(
            hand.top + hand.height / 2 - (bounds.top + bounds.height / 2),
          ) < 3,
        cardClear: hand.bottom <= card.top,
        chainClear:
          !board ||
          card.right <= board.left ||
          card.left >= board.right ||
          card.bottom <= board.top ||
          card.top >= board.bottom,
      };
    });
  });
  for (const seat of seats) {
    expect(seat.centered, `${seat.side} grip follows the table midpoint`).toBe(
      true,
    );
    expect(
      seat.cardClear,
      `${seat.side} name does not cover the held tiles`,
    ).toBe(true);
    expect(seat.chainClear, `${seat.side} badge stays outside the chain`).toBe(
      true,
    );
  }
}
