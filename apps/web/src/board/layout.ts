/** Presentation only: input remains in the server's logical left-to-right order. */
export interface ChainTile {
  readonly left: number;
  readonly right: number;
}
export interface ChainPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180;
}
export interface ChainLayout {
  readonly tiles: readonly ChainPlacement[];
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}
// Match the existing ivory board tiles. The rim also accommodates shadows and
// a double laid crosswise at an edge, without clipping either end of the chain.
const LONG = 82;
const SHORT = 43;
const GAP = 4;
const RIM = 8;
const EDGE = RIM + LONG / 4;

function arrange(board: readonly ChainTile[], width: number): ChainPlacement[] {
  const tiles: ChainPlacement[] = [];
  const leftEdge = EDGE,
    rightEdge = width - EDGE;
  const straightWidth =
    board.reduce(
      (sum, tile) => sum + (tile.left === tile.right ? SHORT : LONG),
      0,
    ) +
    Math.max(0, board.length - 1) * GAP;
  let direction: 1 | -1 = 1;
  let cursor =
    straightWidth <= rightEdge - leftEdge
      ? (width - straightWidth) / 2
      : leftEdge;
  let centerY = RIM + LONG / 2;
  for (const piece of board) {
    const double = piece.left === piece.right;
    const w = double ? SHORT : LONG,
      h = double ? LONG : SHORT;
    const fits =
      direction === 1 ? cursor + w <= rightEdge : cursor - w >= leftEdge;
    const previous = tiles.at(-1);
    if (!fits && previous) {
      // The next horizontal tile would cross the edge. Put this tile below
      // the outgoing half of the last tile, then reverse the horizontal run.
      const tip =
        previous.x +
        previous.width * (direction === 1 ? 1 : 0) -
        direction * (previous.width === LONG ? LONG / 4 : SHORT / 2);
      tiles.push({
        x: tip - h / 2,
        y: previous.y + previous.height + GAP,
        width: h,
        height: w,
        rotation: 90,
      });
      direction = direction === 1 ? -1 : 1;
      // The next tile's incoming half sits directly below this corner.
      cursor = tip;
      centerY = -1;
      continue;
    }
    let x: number, y: number;
    if (centerY === -1 && previous) {
      // A row begins after the vertical connector. The width check above uses
      // its center; the new row extends inward, never out through that edge.
      const half = double ? SHORT / 2 : LONG / 4;
      x = direction === 1 ? cursor - half : cursor + half - w;
      y = previous.y + previous.height + GAP;
      centerY = y + h / 2;
    } else {
      x = direction === 1 ? cursor : cursor - w;
      y = centerY - h / 2;
    }
    tiles.push({
      x,
      y,
      width: w,
      height: h,
      rotation: direction === 1 ? 0 : 180,
    });
    cursor = direction === 1 ? x + w + GAP : x - GAP;
  }
  return tiles;
}

/** Use the largest tile size that fits one table; never hide or scroll tiles. */
export function layoutChain(
  board: readonly ChainTile[],
  availableWidth: number,
  maxHeight = 320,
): ChainLayout {
  const width = Math.max(1, availableWidth);
  // At least three horizontal tiles fit in the layout space, including on a
  // narrow phone. Starting here avoids consecutive turns without a straight run.
  const largestScale = Math.min(1, width / (3 * LONG + 2 * GAP + 2 * EDGE));
  for (let step = 0; step <= 100; step++) {
    const scale = largestScale * (1 - step / 110);
    const tiles = arrange(board, width / scale);
    const height =
      (Math.max(LONG + RIM, ...tiles.map((tile) => tile.y + tile.height)) +
        RIM) *
      scale;
    if (height <= maxHeight || step === 100)
      return { tiles, width, height, scale };
  }
  throw new Error('Unreachable chain layout');
}
