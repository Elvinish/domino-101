import { roomSessionSchema } from '@domino/protocol';
import type { ReconnectSession } from '@domino/protocol';

export const sessionKey = (roomId: string) => `domino101.session.${roomId}`;
export interface SessionStore {
  read(roomId: string): ReconnectSession | null;
  write(session: ReconnectSession): boolean;
  clear(roomId: string): void;
}
/** No hands, scores or socket IDs are persisted. Storage can be denied by the browser. */
export function browserSessions(
  storage: () => Storage = () => window.sessionStorage,
): SessionStore {
  return {
    read(roomId) {
      try {
        const value = storage().getItem(sessionKey(roomId));
        if (!value) return null;
        const parsed = roomSessionSchema.safeParse(JSON.parse(value));
        if (parsed.success && parsed.data.roomId === roomId) return parsed.data;
        storage().removeItem(sessionKey(roomId));
      } catch {
        // Remove corrupt JSON where storage is available; never expose its contents.
        try {
          storage().removeItem(sessionKey(roomId));
        } catch {
          /* Storage denied. */
        }
      }
      return null;
    },
    write(session) {
      try {
        storage().setItem(sessionKey(session.roomId), JSON.stringify(session));
        return true;
      } catch {
        return false;
      }
    },
    clear(roomId) {
      try {
        storage().removeItem(sessionKey(roomId));
      } catch {
        /* Best effort when storage is disabled. */
      }
    },
  };
}
