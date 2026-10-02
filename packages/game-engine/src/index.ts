export type * from './types.js';
export { EngineError } from './errors.js';
export type { EngineErrorCode } from './errors.js';
export {
  SEATS,
  OPENING_DOUBLE_PRIORITY,
  createTile,
  isTile,
  tilePips,
  isDouble,
  createDeck,
  dealTiles,
  findFirstStarter,
  teamOf,
  nextSeat,
  otherTeam,
} from './tiles.js';
export {
  getOpenEnds,
  getLegalPlacements,
  legalMovesForHand,
  placeTile,
} from './board.js';
export {
  createScoreState,
  scoreHand,
  remainingTeamPoints,
  isBlocked,
  resolveBlockedRound,
  applyRoundResult,
  getMatchWinner,
} from './scoring.js';
export type { ScoringOutcome } from './scoring.js';
export { assertMatchState } from './invariants.js';
export {
  createMatch,
  getLegalMoves,
  playTile,
  passTurn,
  startNextRound,
  selectStarter,
} from './match.js';
