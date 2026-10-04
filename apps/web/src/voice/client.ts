import type { Socket } from 'socket.io-client';
import {
  voiceClientSchemas,
  voiceResultSchema,
  voiceParticipantsSchema,
  voiceDescriptionReceivedSchema,
  voiceIceReceivedSchema,
} from '@domino/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomJoined,
  VoiceParticipant,
  VoiceClientEvent,
  VoiceRequests,
  VoiceResult,
  VoiceDescriptionReceived,
  VoiceIceReceived,
} from '@domino/protocol';
import type { MessageKey } from '../i18n';
import { DEFAULT_ICE_SERVERS } from '../config/env';
import { VoicePeer } from './peer';
import type { PeerSnapshot } from './peer';

type VoiceSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export interface VoiceMedia {
  available: () => boolean;
  getUserMedia: () => Promise<MediaStream>;
  createPeer: (config: RTCConfiguration) => RTCPeerConnection;
  createStream: (tracks: MediaStreamTrack[]) => MediaStream;
}
const browserMedia: VoiceMedia = {
  available: () =>
    typeof RTCPeerConnection !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function',
  getUserMedia: () =>
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    }),
  createPeer: (config) => new RTCPeerConnection(config),
  createStream: (tracks) => new MediaStream(tracks),
};
export interface VoiceSnapshot {
  status: 'off' | 'joining' | 'connected' | 'error';
  muted: boolean;
  error: MessageKey | null;
  notice: MessageKey | null;
  participants: VoiceParticipant[];
  peers: (PeerSnapshot & { playerId: string; voiceId: string })[];
}
const initial = (): VoiceSnapshot => ({
  status: 'off',
  muted: true,
  error: null,
  notice: null,
  participants: [],
  peers: [],
});
export class VoiceClient {
  private socket: VoiceSocket | null = null;
  private own: RoomJoined | null = null;
  private voiceId: string | null = null;
  private attemptId: string | null = null;
  private generation = 0;
  private stream: MediaStream | null = null;
  private readonly links = new Map<
    string,
    { voiceId: string; peer: VoicePeer }
  >();
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Set<() => void>();
  private state = initial();
  constructor(
    private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
    private readonly media: VoiceMedia = browserMedia,
  ) {}
  getSnapshot = (): VoiceSnapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<VoiceSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  bind(socket: VoiceSocket): void {
    this.unbind();
    this.socket = socket;
    socket.on('voice:participants', this.participants);
    socket.on('voice:offer', this.offer);
    socket.on('voice:answer', this.answer);
    socket.on('voice:ice', this.ice);
    window.addEventListener('pagehide', this.leave);
  }
  setMembership(own: RoomJoined): void {
    if (
      this.own &&
      (this.own.roomId !== own.roomId || this.own.playerId !== own.playerId)
    )
      this.reset();
    this.own = own;
  }
  reset = (): void => {
    this.cleanup(false);
    this.own = null;
    this.update(initial());
  };
  unbind = (): void => {
    this.cleanup(true);
    this.socket?.off('voice:participants', this.participants);
    this.socket?.off('voice:offer', this.offer);
    this.socket?.off('voice:answer', this.answer);
    this.socket?.off('voice:ice', this.ice);
    window.removeEventListener('pagehide', this.leave);
    this.socket = null;
    this.own = null;
    this.update(initial());
  };
  private request<E extends VoiceClientEvent>(
    event: E,
    payload: VoiceRequests[E],
  ): Promise<VoiceResult> {
    const socket = this.socket;
    if (
      !socket?.connected ||
      !voiceClientSchemas[event].safeParse(payload).success
    )
      return Promise.resolve({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    return new Promise((resolve) => {
      let finished = false;
      const finish = (result: VoiceResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.requests.delete(cancel);
        resolve(result);
      };
      const cancel = () =>
        finish({ ok: false, error: { code: 'SERVER_BUSY' } });
      const timer = setTimeout(cancel, 5000);
      this.requests.add(cancel);
      const emit = socket.emit.bind(socket) as (
        event: VoiceClientEvent,
        payload: VoiceRequests[VoiceClientEvent],
        ack: (data: unknown) => void,
      ) => void;
      try {
        emit(event, payload, (raw) => {
          const parsed = voiceResultSchema.safeParse(raw);
          finish(
            parsed.success
              ? parsed.data
              : { ok: false, error: { code: 'INVALID_PAYLOAD' } },
          );
        });
      } catch {
        cancel();
      }
    });
  }
  enableMicrophone = async (): Promise<void> => {
    if (
      this.state.status === 'joining' ||
      this.state.status === 'connected' ||
      !this.own ||
      !this.socket?.connected
    )
      return;
    this.cleanup(true);
    const generation = this.generation;
    const own = this.own;
    if (!this.media.available()) {
      this.update({ status: 'error', error: 'voice.unavailable' });
      return;
    }
    this.update({ status: 'joining', muted: true, error: null, notice: null });
    let stream: MediaStream;
    try {
      // The only call site for microphone acquisition is this explicit user action.
      stream = await this.media.getUserMedia();
    } catch (error) {
      if (generation !== this.generation) return;
      const name =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        typeof error.name === 'string'
          ? error.name
          : '';
      this.fail(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'voice.denied'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'voice.noMic'
            : 'voice.unavailable',
      );
      return;
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    stream.getTracks().forEach((track) => {
      track.enabled = false;
    });
    const track = stream.getAudioTracks()[0];
    if (
      !track ||
      track.readyState === 'ended' ||
      stream.getVideoTracks().length
    ) {
      this.fail('voice.noMic');
      return;
    }
    track.onended = () => this.fail('voice.deviceEnded');
    this.attemptId = crypto.randomUUID();
    const joined = await this.request('voice:join', {
      roomId: own.roomId,
      attemptId: this.attemptId,
    });
    if (generation !== this.generation) return;
    if (!joined.ok || !joined.voiceId) {
      this.fail('voice.unavailable');
      return;
    }
    this.voiceId = joined.voiceId;
    const ready = await this.request('voice:ready', {
      roomId: own.roomId,
      voiceId: this.voiceId,
      muted: false,
    });
    if (generation !== this.generation) return;
    if (!ready.ok) {
      this.fail('voice.unavailable');
      return;
    }
    track.enabled = true;
    this.update({ status: 'connected', muted: false });
    this.reconcile();
  };
  toggleMute = async (): Promise<void> => {
    if (
      this.state.status !== 'connected' ||
      !this.stream ||
      !this.own ||
      !this.voiceId
    )
      return;
    const generation = this.generation;
    const muted = !this.state.muted;
    this.stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.update({ muted });
    const result = await this.request('voice:state', {
      roomId: this.own.roomId,
      voiceId: this.voiceId,
      muted,
    });
    if (generation === this.generation && !result.ok)
      this.fail('voice.unavailable');
  };
  leave = (): void => {
    this.cleanup(true);
    this.update({
      status: 'off',
      muted: true,
      error: null,
      notice: null,
      peers: [],
    });
  };
  retry = (): void => {
    this.leave();
    void this.enableMicrophone();
  };
  private fail(error: MessageKey): void {
    this.cleanup(true);
    this.update({ status: 'error', muted: true, error, peers: [] });
  }
  private cleanup(notify: boolean): void {
    ++this.generation;
    const roomId = this.own?.roomId,
      attemptId = this.attemptId;
    this.attemptId = null;
    this.voiceId = null;
    for (const cancel of this.requests) cancel();
    for (const { peer } of this.links.values()) peer.close();
    this.links.clear();
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    this.stream = null;
    if (notify && roomId && attemptId && this.socket?.connected) {
      try {
        this.socket.emit('voice:leave', { roomId, attemptId });
      } catch {
        /* Local cleanup is already complete. */
      }
    }
  }
  private participants = (raw: unknown): void => {
    if (!this.own || !this.socket?.connected) return;
    const parsed = voiceParticipantsSchema.safeParse(raw);
    if (!parsed.success) {
      this.fail('voice.unavailable');
      return;
    }
    if (parsed.data.roomId !== this.own.roomId) return;
    const participants = parsed.data.participants;
    const removed = this.state.participants.some(
      (old) =>
        old.playerId !== this.own?.playerId &&
        !participants.some((next) => next.voiceId === old.voiceId),
    );
    const rejoined = participants.some(
      (next) =>
        next.playerId !== this.own?.playerId &&
        next.ready &&
        !this.state.participants.some(
          (old) => old.voiceId === next.voiceId && old.ready,
        ),
    );
    this.update({
      participants,
      ...(rejoined
        ? { notice: null }
        : removed
          ? { notice: 'voice.peerDisconnected' }
          : {}),
    });
    if (
      this.voiceId &&
      !participants.some(
        (entry) =>
          entry.playerId === this.own!.playerId &&
          entry.voiceId === this.voiceId,
      )
    ) {
      this.fail('voice.unavailable');
      return;
    }
    this.reconcile();
  };
  private reconcile(): void {
    for (const [id, link] of this.links)
      if (
        !this.state.participants.some(
          (peer) =>
            peer.playerId === id && peer.voiceId === link.voiceId && peer.ready,
        )
      ) {
        link.peer.close();
        this.links.delete(id);
      }
    const own = this.own,
      voiceId = this.voiceId,
      stream = this.stream;
    const active = this.state.participants.find(
      (entry) =>
        entry.playerId === own?.playerId &&
        entry.voiceId === voiceId &&
        entry.ready,
    );
    if (own && voiceId && stream && active) {
      for (const target of this.state.participants) {
        if (
          target.playerId === own.playerId ||
          !target.ready ||
          this.links.has(target.playerId)
        )
          continue;
        const generation = this.generation;
        const targetFields = {
          roomId: own.roomId,
          voiceId,
          targetId: target.playerId,
          targetVoiceId: target.voiceId,
        };
        try {
          const peer = new VoicePeer({
            stream,
            initiator: own.seat < target.seat,
            iceServers: this.iceServers,
            createPeer: this.media.createPeer,
            createStream: this.media.createStream,
            changed: () => {
              if (generation === this.generation) this.publishPeers();
            },
            description: async (type, sdp) =>
              generation === this.generation &&
              (
                await this.request(
                  type === 'offer' ? 'voice:offer' : 'voice:answer',
                  { ...targetFields, sdp },
                )
              ).ok,
            ice: async (candidate) =>
              generation === this.generation &&
              (await this.request('voice:ice', { ...targetFields, candidate }))
                .ok,
          });
          this.links.set(target.playerId, { voiceId: target.voiceId, peer });
          peer.start();
        } catch {
          this.fail('voice.unavailable');
          return;
        }
      }
    }
    this.publishPeers();
  }
  private publishPeers(): void {
    this.update({
      peers: [...this.links].map(([playerId, { voiceId, peer }]) => ({
        playerId,
        voiceId,
        ...peer.getSnapshot(),
      })),
    });
  }
  private peerFor(
    signal: VoiceDescriptionReceived | VoiceIceReceived,
  ): VoicePeer | undefined {
    if (
      !this.socket?.connected ||
      signal.roomId !== this.own?.roomId ||
      signal.targetVoiceId !== this.voiceId
    )
      return;
    const link = this.links.get(signal.senderId);
    return link?.voiceId === signal.senderVoiceId ? link.peer : undefined;
  }
  private offer = (raw: unknown): void => {
    const parsed = voiceDescriptionReceivedSchema.safeParse(raw);
    if (parsed.success)
      this.peerFor(parsed.data)?.receiveDescription('offer', parsed.data.sdp);
  };
  private answer = (raw: unknown): void => {
    const parsed = voiceDescriptionReceivedSchema.safeParse(raw);
    if (parsed.success)
      this.peerFor(parsed.data)?.receiveDescription('answer', parsed.data.sdp);
  };
  private ice = (raw: unknown): void => {
    const parsed = voiceIceReceivedSchema.safeParse(raw);
    if (parsed.success)
      this.peerFor(parsed.data)?.receiveIce(parsed.data.candidate);
  };
}
