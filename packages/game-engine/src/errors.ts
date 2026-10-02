export type EngineErrorCode =
  | 'INVALID_TILE'
  | 'INVALID_DECK'
  | 'INVALID_HANDS'
  | 'INVALID_BOARD'
  | 'INVALID_SEAT'
  | 'INVALID_TEAM'
  | 'INVALID_SCORE'
  | 'INVALID_RESULT'
  | 'INVALID_STATE'
  | 'INVALID_PHASE'
  | 'NOT_YOUR_TURN'
  | 'TILE_NOT_IN_HAND'
  | 'ILLEGAL_TILE'
  | 'INVALID_END'
  | 'END_REQUIRED'
  | 'PASS_NOT_ALLOWED'
  | 'STARTER_NOT_ELIGIBLE'
  | 'NOT_BLOCKED'
  | 'NO_OPENING_DOUBLE';

export class EngineError extends Error {
  constructor(readonly code: EngineErrorCode) {
    super(code);
    this.name = 'EngineError';
  }
}
export function requireRule(
  condition: unknown,
  code: EngineErrorCode,
): asserts condition {
  if (!condition) throw new EngineError(code);
}

/** Freeze owned values only, never caller-owned inputs. */
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
