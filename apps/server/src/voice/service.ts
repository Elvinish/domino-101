import { randomUUID } from 'node:crypto';
import type {
  VoiceJoin,
  VoiceState,
  VoiceOffer,
  VoiceIce,
  VoiceParticipant,
  VoiceResult,
  VoiceResponses,
  VoiceServerEvent,
} from '@domino/protocol';
import type { Connection, RoomMember } from '../rooms/types.js';
import { requireRoom } from '../rooms/errors.js';

interface Participant {
  readonly socketId: string;
  readonly attemptId: string;
  readonly public: VoiceParticipant;
}
interface VoiceRoom {
  readonly peers: Map<string, Participant>;
  readonly offers: Set<string>;
  readonly answers: Set<string>;
}
export interface VoiceServiceOptions {
  readonly resolveMember: (
    connection: Connection,
    roomId: string,
  ) => RoomMember | null;
  readonly connection: (socketId: string) => Connection;
  readonly recipients: (roomId: string) => readonly string[];
  readonly runRoom: <T>(roomId: string, operation: () => T) => Promise<T>;
  readonly emit: <E extends VoiceServerEvent>(
    socketId: string,
    event: E,
    payload: VoiceResponses[E],
  ) => void;
}
/** Ephemeral signaling only. No repository, media, game state or logging dependency. */
export class VoiceService {
  private readonly rooms = new Map<string, VoiceRoom>();
  constructor(private readonly options: VoiceServiceOptions) {}
  private member(connection: Connection, roomId: string): RoomMember {
    const member = this.options.resolveMember(connection, roomId);
    requireRoom(connection.isConnected() && member, 'NOT_ROOM_MEMBER');
    return member;
  }
  private active(
    connection: Connection,
    roomId: string,
    voiceId: string,
  ): Participant {
    const member = this.member(connection, roomId);
    const entry = this.rooms.get(roomId)?.peers.get(member.playerId);
    requireRoom(
      entry &&
        entry.socketId === connection.id &&
        entry.public.voiceId === voiceId,
      'INVALID_SESSION',
    );
    return entry;
  }
  private broadcast<E extends VoiceServerEvent>(
    roomId: string,
    event: E,
    payload: VoiceResponses[E],
  ): void {
    for (const id of this.options.recipients(roomId)) {
      const connection = this.options.connection(id);
      if (
        connection.isConnected() &&
        this.options.resolveMember(connection, roomId)
      )
        this.options.emit(id, event, payload);
    }
  }
  participantsFor(socketId: string, roomId: string): void {
    const connection = this.options.connection(socketId);
    if (
      !connection.isConnected() ||
      !this.options.resolveMember(connection, roomId)
    )
      return;
    this.options.emit(socketId, 'voice:participants', {
      roomId,
      participants: [...(this.rooms.get(roomId)?.peers.values() ?? [])].map(
        (entry) => entry.public,
      ),
    });
  }
  private snapshot(roomId: string): void {
    for (const socketId of this.options.recipients(roomId))
      this.participantsFor(socketId, roomId);
  }
  join(connection: Connection, payload: VoiceJoin): Promise<VoiceResult> {
    return this.options.runRoom(payload.roomId, () => {
      const member = this.member(connection, payload.roomId);
      let room = this.rooms.get(payload.roomId);
      const previous = room?.peers.get(member.playerId);
      if (
        previous?.socketId === connection.id &&
        previous.attemptId === payload.attemptId
      )
        return { ok: true, voiceId: previous.public.voiceId };
      if (previous) this.removeSocket(previous.socketId);
      room = this.rooms.get(payload.roomId) ?? {
        peers: new Map(),
        offers: new Set(),
        answers: new Set(),
      };
      requireRoom(room.peers.size < 4, 'ROOM_FULL');
      const participant: VoiceParticipant = {
        playerId: member.playerId,
        displayName: member.displayName,
        seat: member.seat,
        voiceId: randomUUID(),
        ready: false,
        muted: true,
      };
      room.peers.set(member.playerId, {
        socketId: connection.id,
        attemptId: payload.attemptId,
        public: participant,
      });
      this.rooms.set(payload.roomId, room);
      this.broadcast(payload.roomId, 'voice:peer-joined', {
        roomId: payload.roomId,
        participant,
      });
      this.snapshot(payload.roomId);
      return { ok: true, voiceId: participant.voiceId };
    });
  }
  state(
    connection: Connection,
    payload: VoiceState,
    ready = false,
  ): Promise<VoiceResult> {
    return this.options.runRoom(payload.roomId, () => {
      const entry = this.active(connection, payload.roomId, payload.voiceId);
      requireRoom(ready || entry.public.ready, 'INVALID_PHASE');
      entry.public.ready = entry.public.ready || ready;
      entry.public.muted = payload.muted;
      this.broadcast(
        payload.roomId,
        ready ? 'voice:peer-ready' : 'voice:state',
        { roomId: payload.roomId, participant: entry.public },
      );
      this.snapshot(payload.roomId);
      return { ok: true };
    });
  }
  signal(
    connection: Connection,
    event: 'voice:offer' | 'voice:answer' | 'voice:ice',
    payload: VoiceOffer | VoiceIce,
  ): Promise<VoiceResult> {
    return this.options.runRoom(payload.roomId, () => {
      const from = this.active(connection, payload.roomId, payload.voiceId);
      const room = this.rooms.get(payload.roomId)!;
      const to = room.peers.get(payload.targetId);
      requireRoom(
        to && to.public.playerId !== from.public.playerId,
        'NOT_ROOM_MEMBER',
      );
      const target = this.member(
        this.options.connection(to.socketId),
        payload.roomId,
      );
      requireRoom(
        target.playerId === payload.targetId &&
          to.public.voiceId === payload.targetVoiceId,
        'INVALID_SESSION',
      );
      requireRoom(from.public.ready && to.public.ready, 'INVALID_PHASE');
      const key = [from.public.voiceId, to.public.voiceId].sort().join(':');
      const received = {
        roomId: payload.roomId,
        senderId: from.public.playerId,
        senderVoiceId: from.public.voiceId,
        targetVoiceId: to.public.voiceId,
      };
      if (event === 'voice:ice' && 'candidate' in payload) {
        this.options.emit(to.socketId, event, {
          ...received,
          candidate: payload.candidate,
        });
      } else if (event !== 'voice:ice' && 'sdp' in payload) {
        if (event === 'voice:offer') {
          requireRoom(
            from.public.seat < to.public.seat && !room.offers.has(key),
            'INVALID_PHASE',
          );
          room.offers.add(key);
        } else {
          requireRoom(
            from.public.seat > to.public.seat &&
              room.offers.has(key) &&
              !room.answers.has(key),
            'INVALID_PHASE',
          );
          room.answers.add(key);
        }
        this.options.emit(to.socketId, event, {
          ...received,
          sdp: payload.sdp,
        });
      } else requireRoom(false, 'INVALID_PAYLOAD');
      return { ok: true };
    });
  }
  leave(connection: Connection, payload: VoiceJoin): Promise<VoiceResult> {
    return this.options.runRoom(payload.roomId, () => {
      const member = this.member(connection, payload.roomId);
      const entry = this.rooms.get(payload.roomId)?.peers.get(member.playerId);
      // A delayed cancellation must never tear down a newer join attempt.
      if (
        entry?.socketId === connection.id &&
        entry.attemptId === payload.attemptId
      )
        this.removeSocket(connection.id);
      return { ok: true };
    });
  }
  removeSocket(socketId: string): void {
    for (const [roomId, room] of this.rooms) {
      const entry = [...room.peers.values()].find(
        (peer) => peer.socketId === socketId,
      );
      if (!entry) continue;
      const { playerId, voiceId } = entry.public;
      room.peers.delete(playerId);
      for (const pairs of [room.offers, room.answers])
        for (const pair of pairs)
          if (pair.split(':').includes(voiceId)) pairs.delete(pair);
      if (!room.peers.size) this.rooms.delete(roomId);
      this.broadcast(roomId, 'voice:peer-left', { roomId, playerId, voiceId });
      this.snapshot(roomId);
    }
  }
  removeRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }
}
