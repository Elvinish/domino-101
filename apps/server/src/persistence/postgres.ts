import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { asc, eq, lte } from 'drizzle-orm';
import {
  roomChat,
  roomCommands,
  roomPlayers,
  roomRecords,
} from '../db/schema.js';
import { parsePersistedChat, parsePersistedRoom } from './codec.js';
import { emptyChat } from './types.js';
import type {
  PersistedChat,
  PersistedRoom,
  PersistenceStore,
} from './types.js';

export class PostgresPersistenceStore implements PersistenceStore {
  private readonly pool: Pool;
  private readonly db;
  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      // SQL errors may include private JSON/parameters. Never log them.
      application_name: 'domino101',
    });
    this.pool.on('error', () => {
      /* Checked out queries fail through the caller's fail-closed path. */
    });
    this.db = drizzle(this.pool);
  }
  async initialize(): Promise<void> {
    await migrate(this.db, {
      migrationsFolder: fileURLToPath(
        new URL('../../drizzle/', import.meta.url),
      ),
    });
    await this.db
      .delete(roomRecords)
      .where(lte(roomRecords.expiresAt, new Date()));
  }
  async loadRooms(): Promise<readonly PersistedRoom[]> {
    const rows = await this.db.select().from(roomRecords);
    const records: PersistedRoom[] = [];
    for (const row of rows) {
      const players = await this.db
        .select()
        .from(roomPlayers)
        .where(eq(roomPlayers.roomId, row.roomId))
        .orderBy(asc(roomPlayers.seat));
      const commands = await this.db
        .select()
        .from(roomCommands)
        .where(eq(roomCommands.roomId, row.roomId))
        .orderBy(asc(roomCommands.position));
      records.push(
        parsePersistedRoom({
          ...row,
          players: players.map((player) => ({
            playerId: player.playerId,
            kind: player.kind,
            displayName: player.displayName,
            seat: player.seat,
            tokenHash: player.tokenHash,
            commands: commands
              .filter((entry) => entry.playerId === player.playerId)
              .map((entry) => ({
                commandId: entry.commandId,
                fingerprint: entry.fingerprint,
                result: entry.result,
              })),
          })),
          createdAt: row.createdAt.getTime(),
          updatedAt: row.updatedAt.getTime(),
          expiresAt: row.expiresAt?.getTime() ?? null,
        }),
      );
    }
    return records;
  }
  async loadChat(roomId: string): Promise<PersistedChat> {
    const [row] = await this.db
      .select()
      .from(roomChat)
      .where(eq(roomChat.roomId, roomId));
    return row ? parsePersistedChat(row.state) : emptyChat();
  }
  async saveRoom(value: PersistedRoom): Promise<void> {
    const room = parsePersistedRoom(value);
    const record = {
      roomId: room.roomId,
      hostId: room.hostId,
      revision: room.revision,
      lifecycle: room.lifecycle,
      matchId: room.matchId,
      matchState: room.matchState,
      persistenceVersion: room.persistenceVersion,
      createdAt: new Date(room.createdAt),
      updatedAt: new Date(room.updatedAt),
      expiresAt: room.expiresAt === null ? null : new Date(room.expiresAt),
    };
    await this.db.transaction(async (tx) => {
      await tx
        .insert(roomRecords)
        .values(record)
        .onConflictDoUpdate({ target: roomRecords.roomId, set: record });
      // Cascades command rows; the replacement is atomic with state and revision.
      await tx.delete(roomPlayers).where(eq(roomPlayers.roomId, room.roomId));
      await tx.insert(roomPlayers).values(
        room.players.map((player) => ({
          roomId: room.roomId,
          playerId: player.playerId,
          kind: player.kind,
          displayName: player.displayName,
          seat: player.seat,
          tokenHash: player.tokenHash,
        })),
      );
      const commands = room.players.flatMap((player) =>
        player.commands.map((command, position) => ({
          roomId: room.roomId,
          playerId: player.playerId,
          position,
          ...command,
        })),
      );
      if (commands.length) await tx.insert(roomCommands).values(commands);
    });
  }
  async saveChat(roomId: string, value: PersistedChat): Promise<void> {
    const state = parsePersistedChat(value);
    // A single atomic row write commits message/history, command result and rate window.
    await this.db
      .insert(roomChat)
      .values({ roomId, state })
      .onConflictDoUpdate({
        target: roomChat.roomId,
        set: { state },
      });
  }
  async deleteRoom(roomId: string): Promise<void> {
    await this.db.delete(roomRecords).where(eq(roomRecords.roomId, roomId));
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
