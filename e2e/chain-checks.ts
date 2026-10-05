import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Check rendered geometry, including rotated doubles, rather than CSS intentions. */
export async function expectChainFits(page: Page) {
  const board = page.locator('.board');
  if (!(await board.count())) return;
  // ResizeObserver publishes the new layout on the browser's next rendering cycle.
  await expect(async () => {
    const geometry = await board.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const table = element.closest('.table-shell')!.getBoundingClientRect();
      const tiles = Array.from(element.querySelectorAll('.domino')).map(
        (tile) => tile.getBoundingClientRect(),
      );
      const inside = (tile: DOMRect, area: DOMRect) =>
        tile.left >= area.left - 1 &&
        tile.right <= area.right + 1 &&
        tile.top >= area.top - 1 &&
        tile.bottom <= area.bottom + 1;
      return {
        count: tiles.length,
        contained: tiles.every(
          (tile) => inside(tile, bounds) && inside(tile, table),
        ),
        noOverlap: tiles.every((tile, index) =>
          tiles
            .slice(index + 1)
            .every(
              (other) =>
                Math.min(tile.right, other.right) -
                  Math.max(tile.left, other.left) <=
                  1 ||
                Math.min(tile.bottom, other.bottom) -
                  Math.max(tile.top, other.top) <=
                  1,
            ),
        ),
        noScroll:
          element.scrollWidth <= element.clientWidth + 1 &&
          document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(geometry.count).toBeGreaterThan(0);
    expect(
      geometry.contained,
      'Every played tile stays visible inside the table',
    ).toBe(true);
    expect(geometry.noOverlap, 'Played tiles do not overlap').toBe(true);
    expect(
      geometry.noScroll,
      'The whole chain fits without horizontal scrolling',
    ).toBe(true);
  }).toPass({ timeout: 3000 });
}
