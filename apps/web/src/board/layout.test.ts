import { describe, expect, it } from 'vitest';
import { layoutChain } from './layout';
import type { ChainTile } from './layout';

const deck: ChainTile[] = [];
for (let left = 0; left <= 6; left++)
  for (let right = left; right <= 6; right++) deck.push({ left, right });
const normal = Array.from({ length: 28 }, () => ({ left: 1, right: 2 }));

it('keeps a short chain centered on one horizontal line, with perpendicular doubles', () => {
  const layout = layoutChain(
    [
      { left: 0, right: 1 },
      { left: 1, right: 1 },
      { left: 1, right: 2 },
    ],
    800,
  );
  expect(layout.scale).toBe(1);
  expect(layout.tiles.map((tile) => tile.rotation)).toEqual([0, 0, 0]);
  expect(
    new Set(layout.tiles.map((tile) => tile.y + tile.height / 2)).size,
  ).toBe(1);
  const [first, middle, last] = layout.tiles;
  expect(first!.x).toBeCloseTo(800 - last!.x - last!.width);
  expect(middle!.height).toBeGreaterThan(middle!.width);
  expect(middle!.x - first!.x - first!.width).toBe(4);
});
it('uses a downward connector only when a horizontal tile would reach the edge, then reverses', () => {
  const { tiles } = layoutChain(normal, 760, 1000);
  expect(tiles.filter((tile) => tile.rotation === 90)).toHaveLength(3);
  for (let index = 1; index < tiles.length; index++) {
    const previous = tiles[index - 1]!,
      tile = tiles[index]!;
    if (tile.rotation === 90) {
      const horizontalEnd =
        previous.rotation === 0
          ? previous.x + previous.width + 4 + 82
          : previous.x - 4 - 82;
      expect(
        previous.rotation === 0 ? horizontalEnd > 760 - 29 : horizontalEnd < 29,
      ).toBe(true);
      expect(tile.y).toBeCloseTo(previous.y + previous.height + 4);
      expect(tile.x < 120 || tile.x + tile.width > 640).toBe(true);
    } else if (previous.rotation === 90) {
      expect(tile.y).toBeCloseTo(previous.y + previous.height + 4);
      expect(tile.rotation).toBe(tiles[index - 2]!.rotation === 0 ? 180 : 0);
    } else {
      expect(tile.y).toBe(previous.y);
      expect(tile.rotation).toBe(previous.rotation);
    }
  }
});
it('preserves the input order and orientation when tiles are added to either end or the viewport changes', () => {
  const chain = deck.slice(3, 22),
    before = structuredClone(chain);
  const small = layoutChain(chain, 300),
    wide = layoutChain(chain, 1100);
  expect(small.tiles).toHaveLength(chain.length);
  expect(wide.tiles.filter((tile) => tile.rotation === 90).length).toBeLessThan(
    small.tiles.filter((tile) => tile.rotation === 90).length,
  );
  expect(
    layoutChain([deck[0]!, ...chain, deck.at(-1)!], 300).tiles,
  ).toHaveLength(chain.length + 2);
  expect(chain).toEqual(before);
});
it('clears the chain for a new round', () => {
  expect(layoutChain([], 320).tiles).toEqual([]);
  expect(layoutChain(normal.slice(0, 1), 320).tiles[0]!.rotation).toBe(0);
});

describe.each([220, 280, 320, 390, 600, 780, 1100])(
  'fits every tile at table width %i',
  (width) => {
    it.each([1, 3, 7, 14, 21, 28])(
      'contains %i tiles without overlaps or clipped doubles',
      (length) => {
        // Every possible position of all seven doubles, including at both corners.
        for (let offset = 0; offset < deck.length; offset++) {
          const board = [...deck.slice(offset), ...deck.slice(0, offset)].slice(
            0,
            length,
          );
          const layout = layoutChain(board, width);
          expect(layout.tiles).toHaveLength(length);
          expect(layout.height).toBeLessThanOrEqual(320);
          for (const [i, tile] of layout.tiles.entries()) {
            expect(tile.x * layout.scale).toBeGreaterThanOrEqual(0);
            expect(tile.y * layout.scale).toBeGreaterThanOrEqual(0);
            expect((tile.x + tile.width) * layout.scale).toBeLessThanOrEqual(
              width,
            );
            expect((tile.y + tile.height) * layout.scale).toBeLessThanOrEqual(
              layout.height,
            );
            for (const other of layout.tiles.slice(i + 1)) {
              const overlapX =
                Math.min(tile.x + tile.width, other.x + other.width) -
                Math.max(tile.x, other.x);
              const overlapY =
                Math.min(tile.y + tile.height, other.y + other.height) -
                Math.max(tile.y, other.y);
              expect(overlapX > 0 && overlapY > 0).toBe(false);
            }
          }
        }
      },
    );
  },
);
