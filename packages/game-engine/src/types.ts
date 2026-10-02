export type Pip = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Tile =
  | '0:0'
  | '0:1'
  | '0:2'
  | '0:3'
  | '0:4'
  | '0:5'
  | '0:6'
  | '1:1'
  | '1:2'
  | '1:3'
  | '1:4'
  | '1:5'
  | '1:6'
  | '2:2'
  | '2:3'
  | '2:4'
  | '2:5'
  | '2:6'
  | '3:3'
  | '3:4'
  | '3:5'
  | '3:6'
  | '4:4'
  | '4:5'
  | '4:6'
  | '5:5'
  | '5:6'
  | '6:6';
export type Seat = 0 | 1 | 2 | 3;
export type Team = 'A' | 'B';
export type Four<T> = readonly [T, T, T, T];
export type Hand = readonly Tile[];
export type Hands = Four<Hand>;
export type MoveEnd = 'start' | 'left' | 'right';
export interface PlacedTile {
  readonly tile: Tile;
  readonly left: Pip;
  readonly right: Pip;
}
export type Board = readonly PlacedTile[];
export interface LegalMove {
  readonly tile: Tile;
  readonly end: MoveEnd;
}
export type OpeningRule =
  | { readonly kind: 'first'; readonly requiredTile: Tile }
  | { readonly kind: 'later' };
export type TeamScore =
  | {
      readonly isScoreOpened: false;
      readonly officialScore: 0;
      readonly pendingOpeningPoints: number;
    }
  | {
      readonly isScoreOpened: true;
      readonly officialScore: number;
      readonly pendingOpeningPoints: 0;
    };
export type TeamTotals = Readonly<Record<Team, number>>;
export interface ScoreState {
  readonly teams: Readonly<Record<Team, TeamScore>>;
  readonly sekaBank: number;
}
export type RoundResult =
  | {
      readonly kind: 'normal' | 'baglanma';
      readonly winner: Team;
      readonly normalPoints: number;
      readonly remainingPoints: TeamTotals;
    }
  | { readonly kind: 'seka'; readonly remainingPoints: TeamTotals };
export interface Round {
  readonly number: number;
  readonly starter: Seat;
  readonly opening: OpeningRule;
  readonly hands: Hands;
  readonly board: Board;
}
export interface PlayingState {
  readonly phase: 'playing';
  readonly score: ScoreState;
  readonly round: Round;
  readonly turn: Seat;
}
export interface RoundEndedState {
  readonly phase: 'round-ended';
  readonly score: ScoreState;
  readonly round: Round;
  readonly result: RoundResult;
  readonly awardedPoints: number;
}
export interface StarterSelectionState {
  readonly phase: 'starter-selection';
  readonly score: ScoreState;
  readonly roundNumber: number;
  readonly hands: Hands;
  readonly eligibleTeam: Team;
}
export interface MatchFinishedState {
  readonly phase: 'match-finished';
  readonly score: ScoreState;
  readonly round: Round;
  readonly result: Exclude<RoundResult, { kind: 'seka' }>;
  readonly awardedPoints: number;
  readonly winner: Team;
}
export type MatchState =
  PlayingState | RoundEndedState | StarterSelectionState | MatchFinishedState;
