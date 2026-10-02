import { emptyChat } from '../persistence/types.js';
import type {
  PersistedChat,
  PersistedRoom,
  PersistenceStore,
} from '../persistence/types.js';

/** Fault injection only; the separate PostgreSQL suite verifies real transactions. */
export class MemoryPersistence implements PersistenceStore {
  readonly rooms = new Map<string, PersistedRoom>();
  readonly chat = new Map<string, PersistedChat>();
  fail = false;
  uncertain = false;
  beforeWrite: (() => Promise<void>) | undefined;
  async initialize() {}
  async loadRooms() {
    return structuredClone([...this.rooms.values()]);
  }
  async loadChat(roomId: string) {
    return structuredClone(this.chat.get(roomId) ?? emptyChat());
  }
  async saveRoom(room: PersistedRoom) {
    await this.beforeWrite?.();
    if (this.fail) throw new Error('injected private database error');
    this.rooms.set(room.roomId, structuredClone(room));
    if (this.uncertain) throw new Error('commit acknowledgement lost');
  }
  async deleteRoom(roomId: string) {
    if (this.fail) throw new Error('injected private database error');
    this.rooms.delete(roomId);
    this.chat.delete(roomId);
  }
  async saveChat(roomId: string, chat: PersistedChat) {
    await this.beforeWrite?.();
    if (this.fail) throw new Error('injected private database error');
    this.chat.set(roomId, structuredClone(chat));
    if (this.uncertain) throw new Error('commit acknowledgement lost');
  }
  async close() {}
}
