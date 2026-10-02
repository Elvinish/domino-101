import type { MatchState, Seat } from '@domino/game-engine';
import type { CommandResult } from '@domino/protocol';
import type { SerialQueue } from './queue.js';

export interface Connection {
  readonly id: string;
  readonly isConnected: () => boolean;
}
export interface Player {
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: Seat;
  socketId: string | null;
  tokenHash: string | null;
  readonly commands: Map<
    string,
    { fingerprint: string; result: CommandResult }
  >;
}
export interface RoomMember {
  readonly roomId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: Seat;
}
export interface Room {
  readonly id: string;
  hostId: string;
  revision: number;
  lifecycle: 'lobby' | 'playing' | 'completed';
  readonly seats: [Player | null, Player | null, Player | null, Player | null];
  match: { id: string; state: MatchState } | null;
  readonly createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  readonly queue: SerialQueue;
}
export function roomReady(room: Room): boolean {
  return room.seats.every(
    (player) => player !== null && player.socketId !== null,
  );
}
