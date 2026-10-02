import { randomUUID } from 'node:crypto';
import {
  chatMessageSchema,
  reactionReceivedSchema,
  reactionSchema,
} from '@domino/protocol';
import type {
  ChatCommand,
  ChatHistory,
  ChatMessage,
  ReactionCommand,
  ReactionReceived,
  SocialResult,
  ErrorCode,
} from '@domino/protocol';
import { errorCode, requireRoom } from '../rooms/errors.js';
import type { Connection, RoomMember } from '../rooms/types.js';
import { parsePersistedChat } from '../persistence/codec.js';
import { fingerprint } from '../persistence/fingerprint.js';
import { emptyChat, COMMAND_HISTORY_LIMIT } from '../persistence/types.js';
import type {
  PersistenceStore,
  PersistedChat,
  PersistedChatCommand,
} from '../persistence/types.js';

const HISTORY_LIMIT = 50;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10_000;

export interface ChatServiceOptions {
  readonly resolveMember: (
    connection: Connection,
    roomId: string,
  ) => RoomMember | null;
  readonly recipients: (roomId: string) => readonly string[];
  readonly playerIds?: (roomId: string) => readonly string[];
  readonly runRoom: <T>(
    roomId: string,
    operation: () => T | Promise<T>,
  ) => Promise<T>;
  readonly onMessage: (
    socketIds: readonly string[],
    message: ChatMessage,
  ) => void;
  readonly onHistory: (socketId: string, history: ChatHistory) => void;
  readonly onReaction: (
    socketIds: readonly string[],
    reaction: ReactionReceived,
  ) => void;
  readonly onPersistenceFailure?: (roomId: string) => void;
  readonly now?: () => number;
  readonly persistence?: PersistenceStore;
}
export class ChatService {
  private readonly states = new Map<string, PersistedChat>();
  private readonly blocked = new Set<string>();
  private readonly now: () => number;
  constructor(private readonly options: ChatServiceOptions) {
    this.now = options.now ?? Date.now;
  }
  async restore(roomIds: readonly string[]): Promise<void> {
    if (!this.options.persistence) return;
    for (const roomId of roomIds)
      this.states.set(
        roomId,
        parsePersistedChat(await this.options.persistence.loadChat(roomId)),
      );
  }
  private failure(code: ErrorCode, commandId?: string): SocialResult {
    return { ok: false, error: { code }, ...(commandId ? { commandId } : {}) };
  }
  private cached(
    state: PersistedChat,
    kind: 'chat' | 'reaction',
    playerId: string,
    commandId: string,
    digest: string,
  ): SocialResult | undefined {
    const prior = state.commands.find(
      (entry) =>
        entry.kind === kind &&
        entry.playerId === playerId &&
        entry.commandId === commandId,
    );
    if (!prior) return undefined;
    return prior.fingerprint === digest
      ? prior.result
      : this.failure('DUPLICATE_COMMAND_CONFLICT', commandId);
  }
  private remember(
    roomId: string,
    state: PersistedChat,
    command: PersistedChatCommand,
  ): PersistedChat {
    const currentPlayers = this.options.playerIds?.(roomId);
    const commands = state.commands.filter(
      (entry) => !currentPlayers || currentPlayers.includes(entry.playerId),
    );
    const same = commands.filter(
      (entry) =>
        entry.kind === command.kind && entry.playerId === command.playerId,
    );
    if (same.length >= COMMAND_HISTORY_LIMIT) {
      const oldest = commands.indexOf(same[0]!);
      commands.splice(oldest, 1);
    }
    commands.push(command);
    return {
      ...state,
      commands: commands.slice(-COMMAND_HISTORY_LIMIT * 8),
      rate: state.rate
        .filter(
          (entry) => !currentPlayers || currentPlayers.includes(entry.playerId),
        )
        .slice(-4),
    };
  }
  private async commit(roomId: string, next: PersistedChat): Promise<void> {
    if (this.options.persistence) {
      try {
        await this.options.persistence.saveChat(roomId, next);
      } catch {
        this.blocked.add(roomId);
        this.options.onPersistenceFailure?.(roomId);
        throw new Error('Persistent social write failed');
      }
    }
    this.states.set(roomId, next);
  }
  send(connection: Connection, payload: ChatCommand): Promise<SocialResult> {
    return this.options
      .runRoom(payload.roomId, async () => {
        requireRoom(!this.blocked.has(payload.roomId), 'SERVER_BUSY');
        const member = this.options.resolveMember(connection, payload.roomId);
        if (!member) return this.failure('NOT_ROOM_MEMBER', payload.commandId);
        const state = this.states.get(payload.roomId) ?? emptyChat();
        const text = payload.text.trim();
        const digest = fingerprint({ roomId: payload.roomId, text });
        const prior = this.cached(
          state,
          'chat',
          member.playerId,
          payload.commandId,
          digest,
        );
        if (prior) return prior;
        let result: SocialResult = { ok: true, commandId: payload.commandId };
        let next = state;
        let message: ChatMessage | undefined;
        if (!text)
          result = this.failure('CHAT_MESSAGE_EMPTY', payload.commandId);
        else if (text.length > 500)
          result = this.failure('CHAT_MESSAGE_TOO_LONG', payload.commandId);
        else {
          const now = this.now();
          const rate = state.rate.filter(
            (entry) => now - entry.startedAt < RATE_WINDOW_MS,
          );
          const window = rate.find(
            (entry) => entry.playerId === member.playerId,
          );
          if (window && window.count >= RATE_LIMIT)
            result = this.failure('CHAT_RATE_LIMITED', payload.commandId);
          else {
            message = chatMessageSchema.parse({
              messageId: randomUUID(),
              sender: {
                playerId: member.playerId,
                displayName: member.displayName,
                seat: member.seat,
              },
              text,
              timestamp: now,
            });
            next = {
              ...state,
              messages: [...state.messages, message].slice(-HISTORY_LIMIT),
              rate: [
                ...rate.filter((entry) => entry.playerId !== member.playerId),
                {
                  playerId: member.playerId,
                  startedAt: window?.startedAt ?? now,
                  count: (window?.count ?? 0) + 1,
                },
              ].slice(-4),
            };
          }
        }
        next = this.remember(payload.roomId, next, {
          kind: 'chat',
          playerId: member.playerId,
          commandId: payload.commandId,
          fingerprint: digest,
          result,
        });
        await this.commit(payload.roomId, next);
        if (message)
          this.options.onMessage(
            this.options.recipients(payload.roomId),
            message,
          );
        return result;
      })
      .catch((error) => this.failure(errorCode(error), payload.commandId));
  }
  sendReaction(
    connection: Connection,
    payload: ReactionCommand,
  ): Promise<SocialResult> {
    return this.options
      .runRoom(payload.roomId, async () => {
        requireRoom(!this.blocked.has(payload.roomId), 'SERVER_BUSY');
        const member = this.options.resolveMember(connection, payload.roomId);
        if (!member) return this.failure('NOT_ROOM_MEMBER', payload.commandId);
        const state = this.states.get(payload.roomId) ?? emptyChat();
        const digest = fingerprint({
          roomId: payload.roomId,
          reaction: payload.reaction,
        });
        const prior = this.cached(
          state,
          'reaction',
          member.playerId,
          payload.commandId,
          digest,
        );
        if (prior) return prior;
        const parsed = reactionSchema.safeParse(payload.reaction);
        const result: SocialResult = parsed.success
          ? { ok: true, commandId: payload.commandId }
          : this.failure('INVALID_REACTION', payload.commandId);
        const reaction = parsed.success
          ? reactionReceivedSchema.parse({
              reactionId: randomUUID(),
              sender: {
                playerId: member.playerId,
                displayName: member.displayName,
                seat: member.seat,
              },
              reaction: parsed.data,
              timestamp: this.now(),
            })
          : null;
        await this.commit(
          payload.roomId,
          this.remember(payload.roomId, state, {
            kind: 'reaction',
            playerId: member.playerId,
            commandId: payload.commandId,
            fingerprint: digest,
            result,
          }),
        );
        if (reaction)
          this.options.onReaction(
            this.options.recipients(payload.roomId),
            reaction,
          );
        return result;
      })
      .catch((error) => this.failure(errorCode(error), payload.commandId));
  }
  historyFor(connection: Connection, roomId: string): Promise<void> {
    return this.options.runRoom(roomId, () => {
      requireRoom(!this.blocked.has(roomId), 'SERVER_BUSY');
      requireRoom(
        this.options.resolveMember(connection, roomId),
        'NOT_ROOM_MEMBER',
      );
      this.options.onHistory(connection.id, {
        roomId,
        messages: [...(this.states.get(roomId)?.messages ?? [])],
      });
    });
  }
  removeRoom(roomId: string): void {
    // Durable deletion belongs to the room transaction's FK cascade, never a fire-and-forget write.
    this.states.delete(roomId);
    this.blocked.delete(roomId);
  }
}
