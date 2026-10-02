import { EngineError } from '@domino/game-engine';
import type { CommandResult, ErrorCode } from '@domino/protocol';

export class RoomError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'RoomError';
  }
}
export function requireRoom(
  condition: unknown,
  code: ErrorCode,
): asserts condition {
  if (!condition) throw new RoomError(code);
}
export function errorCode(error: unknown): ErrorCode {
  if (error instanceof RoomError) return error.code;
  if (error instanceof EngineError) {
    switch (error.code) {
      case 'NOT_YOUR_TURN':
      case 'INVALID_PHASE':
      case 'TILE_NOT_IN_HAND':
      case 'ILLEGAL_TILE':
      case 'INVALID_END':
      case 'END_REQUIRED':
      case 'PASS_NOT_ALLOWED':
      case 'STARTER_NOT_ELIGIBLE':
        return error.code;
      default:
        return 'INTERNAL_ERROR';
    }
  }
  return 'INTERNAL_ERROR';
}
export function failure(code: ErrorCode, commandId?: string): CommandResult {
  return { ok: false, error: { code }, ...(commandId ? { commandId } : {}) };
}
