import { describe, expect, it } from 'vitest';
import {
  getLegalPlacements,
  getOpenEnds,
  legalMovesForHand,
  placeTile,
} from '../index.js';
import type { Board, MoveEnd } from '../index.js';

describe('board and move legality', () => {
  it('has no open ends until a tile opens the board', () => {
    expect(getOpenEnds([])).toBeNull();
    expect(getLegalPlacements([], '2:5')).toEqual(['start']);
    expect(getOpenEnds(placeTile([], '2:5'))).toEqual({ left: 2, right: 5 });
  });
  it('orients a tile correctly on the left', () => {
    const board = placeTile(placeTile([], '1:2'), '1:6');
    expect(board.map((piece) => [piece.left, piece.right])).toEqual([
      [6, 1],
      [1, 2],
    ]);
    expect(getOpenEnds(board)).toEqual({ left: 6, right: 2 });
  });
  it('orients a tile correctly on the right', () => {
    const board = placeTile(placeTile([], '2:5'), '1:5');
    expect(board.map((piece) => [piece.left, piece.right])).toEqual([
      [2, 5],
      [5, 1],
    ]);
    expect(getOpenEnds(board)).toEqual({ left: 2, right: 1 });
  });
  it('returns two alternatives and requires a choice for a tile fitting both ends', () => {
    const board = placeTile(placeTile([], '1:3'), '2:3', 'right');
    expect(getLegalPlacements(board, '1:2')).toEqual(['left', 'right']);
    expect(() => placeTile(board, '1:2')).toThrow('END_REQUIRED');
    expect(getOpenEnds(placeTile(board, '1:2', 'left'))).toEqual({
      left: 2,
      right: 2,
    });
    expect(getOpenEnds(placeTile(board, '1:2', 'right'))).toEqual({
      left: 1,
      right: 1,
    });
  });
  it('also requires an end when both ends have the same pip value', () => {
    const board = placeTile([], '3:3');
    expect(legalMovesForHand(board, ['1:3'])).toEqual([
      { tile: '1:3', end: 'left' },
      { tile: '1:3', end: 'right' },
    ]);
    expect(() => placeTile(board, '1:3')).toThrow('END_REQUIRED');
  });
  it('places doubles without changing the matching open pip', () => {
    const board = placeTile([], '2:5');
    expect(getOpenEnds(placeTile(board, '2:2', 'left'))).toEqual({
      left: 2,
      right: 5,
    });
    expect(getOpenEnds(placeTile(board, '5:5', 'right'))).toEqual({
      left: 2,
      right: 5,
    });
  });
  it('rejects nonmatching tiles, already placed tiles, and the wrong end', () => {
    const board = placeTile([], '2:5');
    expect(() => placeTile(board, '1:6')).toThrow('ILLEGAL_TILE');
    expect(() => placeTile(board, '2:5')).toThrow('ILLEGAL_TILE');
    expect(() => placeTile(board, '1:2', 'right')).toThrow('INVALID_END');
    expect(() => placeTile(board, '1:2', 'start')).toThrow('INVALID_END');
    expect(() => placeTile([], '1:2', 'left')).toThrow('INVALID_END');
    expect(() => placeTile(board, '1:2', 'middle' as MoveEnd)).toThrow(
      'INVALID_END',
    );
  });
  it('rejects disconnected, wrongly oriented and duplicate board pieces', () => {
    const invalid: Board[] = [
      [{ tile: '1:2', left: 1, right: 3 }],
      [
        { tile: '1:2', left: 1, right: 2 },
        { tile: '3:4', left: 3, right: 4 },
      ],
      [
        { tile: '1:2', left: 1, right: 2 },
        { tile: '1:2', left: 2, right: 1 },
      ],
    ];
    for (const board of invalid)
      expect(() => getOpenEnds(board)).toThrow('INVALID_BOARD');
  });
  it('leaves input arrays and pieces unmodified and unfrozen', () => {
    const board: Board = [{ tile: '1:2', left: 1, right: 2 }];
    const after = placeTile(board, '2:6');
    expect(board).toHaveLength(1);
    expect(Object.isFrozen(board)).toBe(false);
    expect(Object.isFrozen(board[0])).toBe(false);
    expect(Object.isFrozen(after[0])).toBe(true);
  });
});
