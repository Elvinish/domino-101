import { freeze, requireRule } from './errors.js';
import { isDouble, isTile, tilePips } from './tiles.js';
import type {
  Board,
  Hand,
  LegalMove,
  MoveEnd,
  OpeningRule,
  Pip,
  Tile,
} from './types.js';

export function assertBoard(board: Board): void {
  const seen = new Set<Tile>();
  for (let index = 0; index < board.length; index++) {
    const piece = board[index]!;
    requireRule(isTile(piece.tile) && !seen.has(piece.tile), 'INVALID_BOARD');
    const [a, b] = tilePips(piece.tile);
    requireRule(
      (piece.left === a && piece.right === b) ||
        (piece.left === b && piece.right === a),
      'INVALID_BOARD',
    );
    requireRule(
      index === 0 || board[index - 1]!.right === piece.left,
      'INVALID_BOARD',
    );
    seen.add(piece.tile);
  }
}
export function getOpenEnds(
  board: Board,
): { readonly left: Pip; readonly right: Pip } | null {
  assertBoard(board);
  if (board.length === 0) return null;
  return Object.freeze({
    left: board[0]!.left,
    right: board[board.length - 1]!.right,
  });
}
export function getLegalPlacements(
  board: Board,
  tile: Tile,
): readonly MoveEnd[] {
  const [a, b] = tilePips(tile);
  const ends = getOpenEnds(board);
  if (board.some((piece) => piece.tile === tile)) return [];
  if (!ends) return ['start'];
  const moves: MoveEnd[] = [];
  if (a === ends.left || b === ends.left) moves.push('left');
  if (a === ends.right || b === ends.right) moves.push('right');
  return Object.freeze(moves);
}
export function legalMovesForHand(
  board: Board,
  hand: Hand,
  opening?: OpeningRule,
): readonly LegalMove[] {
  requireRule(
    hand.every(isTile) && new Set(hand).size === hand.length,
    'INVALID_HANDS',
  );
  let allowed = hand;
  if (board.length === 0 && opening) {
    if (opening.kind === 'first')
      allowed = hand.filter((tile) => tile === opening.requiredTile);
    else if (hand.some(isDouble)) allowed = hand.filter(isDouble);
  }
  return freeze(
    allowed.flatMap((tile) =>
      getLegalPlacements(board, tile).map((end) => ({ tile, end })),
    ),
  );
}
/** Opening restrictions are enforced by the match reducer, not this board primitive. */
export function placeTile(board: Board, tile: Tile, end?: MoveEnd): Board {
  if (end !== undefined)
    requireRule(['start', 'left', 'right'].includes(end), 'INVALID_END');
  const ends = getLegalPlacements(board, tile);
  requireRule(ends.length > 0, 'ILLEGAL_TILE');
  requireRule(end !== undefined || ends.length === 1, 'END_REQUIRED');
  const chosen = end ?? ends[0]!;
  requireRule(ends.includes(chosen), 'INVALID_END');
  const [a, b] = tilePips(tile);
  // Clone the caller's chain before freezing the new board.
  const pieces = board.map((piece) => ({ ...piece }));
  if (chosen === 'start') return freeze([{ tile, left: a, right: b }]);
  if (chosen === 'left') {
    const join = board[0]!.left;
    pieces.unshift({ tile, left: a === join ? b : a, right: join });
  } else {
    const join = board[board.length - 1]!.right;
    pieces.push({ tile, left: join, right: a === join ? b : a });
  }
  return freeze(pieces);
}
