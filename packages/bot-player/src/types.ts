import type {
  Board,
  Four,
  Hand,
  MatchState,
  MoveEnd,
  ScoreState,
  Seat,
  Team,
  TeamTotals,
  Tile,
} from '@domino/game-engine';

export type Strategy = 'deterministic-first' | 'seeded-random';
export type BotCommand =
  | {
      readonly type: 'play';
      readonly seat: Seat;
      readonly tile: Tile;
      readonly end: MoveEnd;
    }
  | { readonly type: 'pass'; readonly seat: Seat }
  | {
      readonly type: 'select-starter';
      readonly seat: Seat;
      readonly selected: Seat;
    };
export type SimulationCommand = BotCommand | { readonly type: 'next-round' };
/** Local QA view, not a network DTO. Never includes any other player's tiles. */
export interface BotView {
  readonly phase: MatchState['phase'];
  readonly seat: Seat;
  readonly roundNumber: number;
  readonly hand: Hand;
  readonly handCounts: Four<number>;
  readonly board: Board;
  readonly score: ScoreState;
  readonly turn: Seat | null;
  readonly eligibleTeam: Team | null;
  readonly legalActions: readonly BotCommand[];
}
export interface StateSummary {
  readonly phase: MatchState['phase'];
  readonly roundNumber: number;
  readonly turn: Seat | null;
  readonly starter: Seat | null;
  readonly eligibleTeam: Team | null;
  readonly handCounts: Four<number>;
  readonly boardCount: number;
  readonly openEnds: { readonly left: number; readonly right: number } | null;
  readonly score: ScoreState;
}
export interface TraceEntry {
  readonly commandIndex: number;
  readonly command: SimulationCommand;
  readonly before: StateSummary;
  readonly after: StateSummary;
}
export interface Coverage {
  readonly passes: number;
  readonly ambiguousPlacements: number;
  readonly starterSelections: number;
  readonly startersWithoutDouble: number;
  readonly startersWithMultipleDoubles: number;
  readonly pendingAccumulations: number;
  readonly pendingBurns: number;
  readonly scoreOpenings: number;
  readonly bankClaims: number;
  readonly consecutiveSeka: number;
}
export interface RoundSummary {
  readonly roundNumber: number;
  readonly kind: 'normal' | 'baglanma' | 'seka';
  readonly winner: Team | null;
  readonly awardedPoints: number;
  readonly score: ScoreState;
}
export interface SimulationOptions {
  readonly seed: number;
  readonly strategies?: Strategy | Four<Strategy>;
  /** Must be a legitimate engine-produced snapshot; replay requires the same snapshot. */
  readonly initialState?: MatchState;
  readonly maxCommands?: number;
  /** Maximum absolute round number, including a supplied initial state's round. */
  readonly maxRounds?: number;
  readonly recordTrace?: boolean;
}
export interface SimulationResult {
  readonly version: 'domino-simulation-v1';
  readonly seed: number;
  readonly strategies: Four<Strategy>;
  readonly origin: 'fresh' | 'provided';
  readonly winner: Team;
  readonly finalScores: TeamTotals;
  readonly score: ScoreState;
  readonly roundCount: number;
  readonly roundsCompleted: number;
  readonly commandCount: number;
  readonly sekaCount: number;
  readonly safetyLimitHit: false;
  readonly transcriptHash: string;
  readonly coverage: Coverage;
  readonly rounds: readonly RoundSummary[];
  readonly trace?: readonly TraceEntry[];
}
