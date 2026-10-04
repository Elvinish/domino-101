import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeVoice,
  fakeTrack,
  fakeStream,
  flushVoice,
  remoteParticipant,
  AUDIO_SDP,
} from '../test/voice';
import { roomId } from '../test/multiplayer';

const clients: ReturnType<typeof fakeVoice>[] = [];
function setup(seat: 0 | 1 = 0) {
  const value = fakeVoice(seat);
  clients.push(value);
  return value;
}
afterEach(() => {
  clients.splice(0).forEach((f) => f.voice.unbind());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function signal(
  f: ReturnType<typeof fakeVoice>,
  peer: ReturnType<typeof remoteParticipant>,
) {
  return {
    roomId,
    senderId: peer.playerId,
    senderVoiceId: peer.voiceId,
    targetVoiceId: f.voiceId(),
  };
}
describe('explicit microphone lifecycle', () => {
  it('keeps the acquired track disabled until ready is acknowledged', async () => {
    const f = setup();
    const original = f.socket.emit.getMockImplementation()!;
    let ready!: () => void;
    f.socket.emit.mockImplementation((event, payload, ack) => {
      if (event === 'voice:ready') ready = () => original(event, payload, ack);
      else original(event, payload, ack);
    });
    const pending = f.voice.enableMicrophone();
    await flushVoice();
    expect(f.local.track.enabled).toBe(false);
    expect(f.voice.getSnapshot().status).toBe('joining');
    ready();
    await pending;
    expect(f.local.track.enabled).toBe(true);
  });
  it('keeps transport exceptions confined to voice and stops acquired media', async () => {
    const f = setup();
    f.socket.emit.mockImplementation(() => {
      throw new Error('private transport details');
    });
    await expect(f.voice.enableMicrophone()).resolves.toBeUndefined();
    expect(f.local.track.stop).toHaveBeenCalledTimes(1);
    expect(f.voice.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'voice.unavailable',
    });
  });
  it('starts off without acquiring media or creating peers, even when other players join voice', () => {
    const f = setup();
    f.participants([remoteParticipant()]);
    expect(f.voice.getSnapshot()).toMatchObject({
      status: 'off',
      muted: true,
      peers: [],
    });
    expect(f.media.getUserMedia).not.toHaveBeenCalled();
    expect(f.media.createPeer).not.toHaveBeenCalled();
    expect(f.socket.emit).not.toHaveBeenCalled();
  });
  it('enables explicitly, mutes/unmutes the existing track, and stops it on leave', async () => {
    const f = setup();
    await f.voice.enableMicrophone();
    expect(f.voice.getSnapshot()).toMatchObject({
      status: 'connected',
      muted: false,
    });
    expect(f.local.track.enabled).toBe(true);
    await f.voice.toggleMute();
    expect(f.local.track.enabled).toBe(false);
    expect(f.voice.getSnapshot().muted).toBe(true);
    await f.voice.toggleMute();
    expect(f.local.track.enabled).toBe(true);
    expect(f.media.getUserMedia).toHaveBeenCalledTimes(1);
    f.voice.leave();
    expect(f.local.track.stop).toHaveBeenCalledTimes(1);
    expect(f.voice.getSnapshot()).toMatchObject({ status: 'off', muted: true });
    expect(
      f.socket.emit.mock.calls.some(([event]) => event === 'voice:leave'),
    ).toBe(true);
  });
  it.each([
    ['NotAllowedError', 'voice.denied'],
    ['SecurityError', 'voice.denied'],
    ['NotFoundError', 'voice.noMic'],
    ['NotReadableError', 'voice.unavailable'],
  ])(
    'handles %s without exposing raw exceptions or signaling',
    async (name, key) => {
      const f = setup();
      f.media.getUserMedia.mockRejectedValue(
        new DOMException('private device details', name),
      );
      await f.voice.enableMicrophone();
      expect(f.voice.getSnapshot()).toMatchObject({
        status: 'error',
        muted: true,
        error: key,
      });
      expect(JSON.stringify(f.voice.getSnapshot())).not.toContain(
        'private device details',
      );
      expect(f.socket.emit).not.toHaveBeenCalled();
    },
  );
  it('handles missing browser media APIs without acquiring anything', async () => {
    const f = setup();
    f.media.available.mockReturnValue(false);
    await f.voice.enableMicrophone();
    expect(f.voice.getSnapshot().error).toBe('voice.unavailable');
    expect(f.media.getUserMedia).not.toHaveBeenCalled();
  });
  it('stops a permission result that arrives after leave and never re-enables it', async () => {
    const f = setup();
    let resolve!: (stream: MediaStream) => void;
    f.media.getUserMedia.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = f.voice.enableMicrophone();
    await f.voice.enableMicrophone();
    expect(f.media.getUserMedia).toHaveBeenCalledTimes(1);
    f.voice.leave();
    resolve(f.local.stream);
    await pending;
    expect(f.local.track.stop).toHaveBeenCalledTimes(1);
    expect(f.voice.getSnapshot().status).toBe('off');
    expect(f.socket.emit).not.toHaveBeenCalled();
  });
  it('stops voice if its device ends and requires a fresh explicit action', async () => {
    const f = setup();
    await f.voice.enableMicrophone();
    f.local.track.onended?.(new Event('ended'));
    expect(f.voice.getSnapshot()).toMatchObject({
      status: 'error',
      muted: true,
      error: 'voice.deviceEnded',
    });
    expect(f.local.track.stop).toHaveBeenCalledTimes(1);
    expect(f.media.getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('cancels a timed-out join without leaving an orphaned attempt', async () => {
    vi.useFakeTimers();
    const f = setup();
    f.socket.emit.mockImplementation(() => {});
    const pending = f.voice.enableMicrophone();
    await flushVoice();
    await vi.advanceTimersByTimeAsync(5001);
    await pending;
    expect(f.voice.getSnapshot()).toMatchObject({
      status: 'error',
      muted: true,
    });
    expect(f.local.track.stop).toHaveBeenCalledTimes(1);
    const attempt = f.socket.emit.mock.calls.find(
      ([event]) => event === 'voice:join',
    )![1].attemptId;
    expect(
      f.socket.emit.mock.calls.find(([event]) => event === 'voice:leave')![1]
        .attemptId,
    ).toBe(attempt);
  });
});
describe('peer negotiation and cleanup', () => {
  it('clears the old disconnect notice when a remote participant explicitly rejoins', async () => {
    const f = setup();
    f.participants([remoteParticipant()]);
    await f.voice.enableMicrophone();
    f.participants([]);
    expect(f.voice.getSnapshot().notice).toBe('voice.peerDisconnected');
    f.participants([remoteParticipant()]);
    expect(f.voice.getSnapshot().notice).toBeNull();
  });
  it('creates each of three peers once, with only an audio track, despite repeated participant snapshots', async () => {
    const f = setup(),
      others = [
        remoteParticipant(1),
        remoteParticipant(2),
        remoteParticipant(3),
      ];
    f.participants(others);
    await f.voice.enableMicrophone();
    f.participants(others);
    await flushVoice();
    expect(f.pcs).toHaveLength(3);
    expect(
      f.socket.emit.mock.calls.filter(([event]) => event === 'voice:offer'),
    ).toHaveLength(3);
    for (const pc of f.pcs)
      expect(pc.addTrack).toHaveBeenCalledExactlyOnceWith(
        f.local.track,
        f.local.stream,
      );
  });
  it('queues ICE until the remote answer and attaches one logical audio stream per peer', async () => {
    const f = setup(),
      remote = remoteParticipant();
    f.participants([remote]);
    await f.voice.enableMicrophone();
    await flushVoice();
    const pc = f.pcs[0]!;
    f.receive('voice:ice', {
      ...signal(f, remote),
      candidate: { candidate: 'candidate:test', sdpMid: '0', sdpMLineIndex: 0 },
    });
    await flushVoice();
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    f.receive('voice:answer', { ...signal(f, remote), sdp: AUDIO_SDP });
    await flushVoice();
    expect(pc.setRemoteDescription).toHaveBeenCalledExactlyOnceWith({
      type: 'answer',
      sdp: AUDIO_SDP,
    });
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    const remoteTrack = fakeTrack();
    pc.ontrack?.({ track: remoteTrack as unknown as MediaStreamTrack });
    const stream = f.voice.getSnapshot().peers[0]!.stream;
    pc.ontrack?.({ track: remoteTrack as unknown as MediaStreamTrack });
    expect(f.voice.getSnapshot().peers[0]!.stream).toBe(stream);
    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();
    expect(f.voice.getSnapshot().peers[0]!.status).toBe('connected');
    f.participants([]);
    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(remoteTrack.stop).toHaveBeenCalledTimes(1);
    expect(f.voice.getSnapshot().peers).toEqual([]);
  });
  it('only the higher seat answers an offer; it does not create a competing offer', async () => {
    const f = setup(1),
      remote = remoteParticipant(0);
    f.participants([remote]);
    await f.voice.enableMicrophone();
    await flushVoice();
    expect(f.pcs[0]!.createOffer).not.toHaveBeenCalled();
    f.receive('voice:offer', { ...signal(f, remote), sdp: AUDIO_SDP });
    await flushVoice();
    expect(f.pcs[0]!.createAnswer).toHaveBeenCalledTimes(1);
    expect(
      f.socket.emit.mock.calls.filter(([event]) => event === 'voice:answer'),
    ).toHaveLength(1);
  });
  it('ignores wrong room, target session and old sender sessions', async () => {
    const f = setup(),
      remote = remoteParticipant();
    f.participants([remote]);
    await f.voice.enableMicrophone();
    await flushVoice();
    const base = { ...signal(f, remote), sdp: AUDIO_SDP };
    for (const invalid of [
      { ...base, roomId: 'b'.repeat(32) },
      { ...base, targetVoiceId: crypto.randomUUID() },
      { ...base, senderVoiceId: crypto.randomUUID() },
    ])
      f.receive('voice:answer', invalid);
    await flushVoice();
    expect(f.pcs[0]!.setRemoteDescription).not.toHaveBeenCalled();
  });
  it('replaces a peer connection cleanly for a new voice session', async () => {
    const f = setup(),
      remote = remoteParticipant();
    f.participants([remote]);
    await f.voice.enableMicrophone();
    await flushVoice();
    const old = f.pcs[0]!;
    f.participants([{ ...remote, voiceId: crypto.randomUUID() }]);
    await flushVoice();
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(f.pcs).toHaveLength(2);
    expect(f.voice.getSnapshot().peers).toHaveLength(1);
  });
  it.each(['disconnect', 'teardown', 'pagehide'])(
    'stops streams and peers on %s without auto-enabling on reconnect',
    async (kind) => {
      const f = setup();
      f.participants([remoteParticipant()]);
      await f.voice.enableMicrophone();
      await flushVoice();
      const pc = f.pcs[0]!;
      if (kind === 'disconnect') {
        f.socket.connected = false;
        f.voice.reset();
      } else if (kind === 'teardown') f.voice.unbind();
      else window.dispatchEvent(new Event('pagehide'));
      expect(f.local.track.stop).toHaveBeenCalledTimes(1);
      expect(pc.close).toHaveBeenCalledTimes(1);
      expect(pc.onicecandidate).toBeNull();
      expect(pc.ontrack).toBeNull();
      f.socket.connected = true;
      f.voice.setMembership(f.own);
      expect(f.media.getUserMedia).toHaveBeenCalledTimes(1);
      expect(f.voice.getSnapshot()).toMatchObject({
        status: 'off',
        muted: true,
        peers: [],
      });
    },
  );
  it('marks a failed peer unavailable without stopping other peers or retrying endlessly', async () => {
    const f = setup();
    f.participants([remoteParticipant(1), remoteParticipant(2)]);
    await f.voice.enableMicrophone();
    await flushVoice();
    f.pcs[0]!.connectionState = 'failed';
    f.pcs[0]!.onconnectionstatechange?.();
    expect(f.voice.getSnapshot().peers[0]!.status).toBe('failed');
    expect(f.pcs[0]!.close).toHaveBeenCalledTimes(1);
    expect(f.pcs[1]!.close).not.toHaveBeenCalled();
    expect(f.local.track.stop).not.toHaveBeenCalled();
    f.participants([
      ...f.voice
        .getSnapshot()
        .participants.filter((peer) => peer.playerId !== f.own.playerId),
    ]);
    expect(f.pcs).toHaveLength(2);
  });
  it('closes a connection that stays disconnected beyond the grace period', async () => {
    vi.useFakeTimers();
    const f = setup();
    f.participants([remoteParticipant()]);
    await f.voice.enableMicrophone();
    await flushVoice();
    f.pcs[0]!.connectionState = 'disconnected';
    f.pcs[0]!.onconnectionstatechange?.();
    expect(f.voice.getSnapshot().peers[0]!.status).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(10001);
    expect(f.voice.getSnapshot().peers[0]!.status).toBe('failed');
    expect(f.pcs).toHaveLength(1);
  });
  it('discards an offer that finishes after disconnect instead of signaling on a newer connection', async () => {
    const f = setup();
    await f.voice.enableMicrophone();
    const original = f.media.createPeer.getMockImplementation()!;
    let resolve!: (description: RTCSessionDescriptionInit) => void;
    f.media.createPeer.mockImplementation((config) => {
      const result = original(config);
      f.pcs.at(-1)!.createOffer.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      return result;
    });
    f.participants([remoteParticipant()]);
    await flushVoice();
    f.voice.reset();
    resolve({ type: 'offer', sdp: AUDIO_SDP });
    await flushVoice();
    expect(f.pcs[0]!.setLocalDescription).not.toHaveBeenCalled();
    expect(
      f.socket.emit.mock.calls.filter(([event]) => event === 'voice:offer'),
    ).toEqual([]);
  });
  it('can explicitly rejoin with a fresh stream after leaving', async () => {
    const f = setup();
    await f.voice.enableMicrophone();
    const old = f.voiceId();
    f.voice.leave();
    const fresh = fakeStream();
    f.media.getUserMedia.mockResolvedValue(fresh.stream);
    await f.voice.enableMicrophone();
    expect(f.voiceId()).not.toBe(old);
    expect(fresh.track.enabled).toBe(true);
    expect(f.media.getUserMedia).toHaveBeenCalledTimes(2);
  });
});
