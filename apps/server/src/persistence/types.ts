import type {
  ChatMessage,
  CommandResult,
  SocialResult,
} from '@domino/protocol';
import type { MatchState, Seat } from '@domino/game-engine';

export const PERSISTENCE_VERSION = 1;
export const COMMAND_HISTORY_LIMIT = 128;

export interface PersistedCommand {
  readonly commandId: string;
  readonly fingerprint: string;
  readonly result: CommandResult;
}
export interface PersistedPlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: Seat;
  readonly tokenHash: string | null;
  readonly commands: readonly PersistedCommand[];
}
export interface PersistedRoom {
  readonly persistenceVersion: typeof PERSISTENCE_VERSION;
  readonly roomId: string;
  readonly hostId: string;
  readonly revision: number;
  readonly lifecycle: 'lobby' | 'playing' | 'completed';
  readonly matchId: string | null;
  readonly matchState: MatchState | null;
  readonly players: readonly PersistedPlayer[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
}
export interface PersistedChatCommand {
  readonly kind: 'chat' | 'reaction';
  readonly playerId: string;
  readonly commandId: string;
  readonly fingerprint: string;
  readonly result: SocialResult;
}
export interface PersistedChat {
  readonly persistenceVersion: typeof PERSISTENCE_VERSION;
  readonly messages: readonly ChatMessage[];
  readonly commands: readonly PersistedChatCommand[];
  readonly rate: readonly {
    playerId: string;
    startedAt: number;
    count: number;
  }[];
}
export function emptyChat(): PersistedChat {
  return {
    persistenceVersion: PERSISTENCE_VERSION,
    messages: [],
    commands: [],
    rate: [],
  };
}

/** Each write resolves only after COMMIT. Callers treat any rejection as uncertain. */
export interface PersistenceStore {
  initialize(): Promise<void>;
  loadRooms(): Promise<readonly PersistedRoom[]>;
  loadChat(roomId: string): Promise<PersistedChat>;
  saveRoom(room: PersistedRoom): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  saveChat(roomId: string, chat: PersistedChat): Promise<void>;
  close(): Promise<void>;
}
