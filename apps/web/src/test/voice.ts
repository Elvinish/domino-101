import { vi } from 'vitest';
import type { VoiceParticipant } from '@domino/protocol';
import { VoiceClient } from '../voice/client';
import type { GameSocket } from '../multiplayer/client';
import { own, roomId } from './multiplayer';

export const AUDIO_SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
export function fakeTrack() {
  const track = {
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    onended: null as ((event: Event) => void) | null,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  };
  return track;
}
export function fakeStream(track = fakeTrack()) {
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
      getVideoTracks: () => [],
    } as unknown as MediaStream,
  };
}
export class FakePeer {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState = 'new';
  onicecandidate:
    ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTrack = vi.fn();
  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({
    type: 'offer',
    sdp: AUDIO_SDP,
  }));
  createAnswer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({
    type: 'answer',
    sdp: AUDIO_SDP,
  }));
  setLocalDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.localDescription = description;
    },
  );
  setRemoteDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.remoteDescription = description;
    },
  );
  addIceCandidate = vi
    .fn<(candidate: RTCIceCandidateInit | null) => Promise<void>>()
    .mockResolvedValue(undefined);
  close = vi.fn(() => {
    this.connectionState = 'closed';
  });
}
export async function flushVoice() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}
export function fakeVoice(seat: 0 | 1 = 0) {
  const assigned = { ...own, seat };
  const listeners = new Map<string, (payload: unknown) => void>();
  const pcs: FakePeer[] = [];
  const local = fakeStream();
  let voiceId = crypto.randomUUID(),
    joined = false,
    ready = false,
    muted = true;
  let others: VoiceParticipant[] = [];
  const broadcast = () =>
    listeners.get('voice:participants')?.({
      roomId,
      participants: [
        ...(joined
          ? [
              {
                playerId: assigned.playerId,
                seat,
                displayName: 'Ayla',
                voiceId,
                ready,
                muted,
              },
            ]
          : []),
        ...others,
      ],
    });
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: (payload: unknown) => void) =>
      listeners.set(event, listener),
    ),
    off: vi.fn((event: string) => listeners.delete(event)),
    emit: vi.fn(
      (
        event: string,
        payload: Record<string, unknown>,
        ack?: (result: unknown) => void,
      ) => {
        if (event === 'voice:join') {
          joined = true;
          ready = false;
          muted = true;
          voiceId = crypto.randomUUID();
          broadcast();
          ack?.({ ok: true, voiceId });
        } else if (event === 'voice:ready') {
          ready = true;
          muted = payload.muted === true;
          broadcast();
          ack?.({ ok: true });
        } else if (event === 'voice:state') {
          muted = payload.muted === true;
          broadcast();
          ack?.({ ok: true });
        } else if (event === 'voice:leave') {
          joined = false;
          broadcast();
          ack?.({ ok: true });
        } else ack?.({ ok: true });
      },
    ),
  };
  const media = {
    available: vi.fn(() => true),
    getUserMedia: vi.fn(async () => local.stream),
    createPeer: vi.fn<(config: RTCConfiguration) => RTCPeerConnection>(() => {
      const pc = new FakePeer();
      pcs.push(pc);
      return pc as unknown as RTCPeerConnection;
    }),
    createStream: (tracks: MediaStreamTrack[]) =>
      ({
        getTracks: () => tracks,
        getAudioTracks: () => tracks,
      }) as unknown as MediaStream,
  };
  const voice = new VoiceClient([], media);
  voice.bind(socket as unknown as GameSocket);
  voice.setMembership(assigned);
  return {
    voice,
    socket,
    media,
    pcs,
    local,
    own: assigned,
    listeners,
    voiceId: () => voiceId,
    receive: (event: string, payload: unknown) =>
      listeners.get(event)?.(payload),
    participants: (value: VoiceParticipant[]) => {
      others = value;
      broadcast();
    },
  };
}
export function remoteParticipant(seat: 0 | 1 | 2 | 3 = 1): VoiceParticipant {
  return {
    playerId: `10000000-0000-4000-8000-00000000000${seat}`,
    seat,
    displayName: `Peer ${seat}`,
    voiceId: crypto.randomUUID(),
    ready: true,
    muted: false,
  };
}
