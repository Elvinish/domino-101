import { describe, expect, it } from 'vitest';
import {
  voiceJoinSchema,
  voiceReadySchema,
  voiceOfferSchema,
  voiceIceSchema,
  voiceParticipantsSchema,
  voiceResultSchema,
  voiceServerSchemas,
  serverErrorSchema,
} from './index.js';
const roomId = 'a'.repeat(32);
const id = '00000000-0000-4000-8000-000000000001';
const target = { roomId, voiceId: id, targetId: id, targetVoiceId: id };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
describe('bounded audio-only signaling schemas', () => {
  it('parses join/ready and safe acknowledgements', () => {
    expect(voiceJoinSchema.safeParse({ roomId, attemptId: id }).success).toBe(
      true,
    );
    expect(
      voiceReadySchema.safeParse({ roomId, voiceId: id, muted: false }).success,
    ).toBe(true);
    expect(voiceResultSchema.safeParse({ ok: true, voiceId: id }).success).toBe(
      true,
    );
    expect(
      serverErrorSchema.safeParse({
        event: 'voice:ice',
        code: 'INVALID_PAYLOAD',
      }).success,
    ).toBe(true);
  });
  it.each([
    'playerId',
    'senderId',
    'seat',
    'displayName',
    'reconnectToken',
    'audio',
  ])('rejects client-injected %s', (key) => {
    expect(
      voiceJoinSchema.safeParse({ roomId, attemptId: id, [key]: id }).success,
    ).toBe(false);
    expect(
      voiceOfferSchema.safeParse({ ...target, sdp, [key]: id }).success,
    ).toBe(false);
  });
  it.each([
    '',
    'raw audio',
    'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n',
    sdp + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
    sdp + 'm=audio 9 RTP/AVP 0\r\n',
    'v=0\nm=audio 9 RTP/AVP 0\rm=video 9 RTP/AVP 0',
    sdp + 'a'.repeat(6000),
  ])(
    'rejects non-audio, multiple m-line or oversized descriptions %#',
    (value) => {
      expect(
        voiceOfferSchema.safeParse({ ...target, sdp: value }).success,
      ).toBe(false);
    },
  );
  it('bounds ICE and supports an end-of-candidates marker without accepting arbitrary data', () => {
    expect(
      voiceIceSchema.safeParse({ ...target, candidate: null }).success,
    ).toBe(true);
    const candidate = {
      candidate: 'candidate:test',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };
    expect(voiceIceSchema.safeParse({ ...target, candidate }).success).toBe(
      true,
    );
    for (const invalid of [
      { ...candidate, candidate: 'a'.repeat(2049) },
      { ...candidate, sdpMLineIndex: 1 },
      { ...candidate, password: 'secret' },
    ])
      expect(
        voiceIceSchema.safeParse({ ...target, candidate: invalid }).success,
      ).toBe(false);
  });
  it('caps and de-duplicates four public voice participants', () => {
    const participant = {
      playerId: id,
      voiceId: id,
      displayName: 'Guest',
      seat: 0,
      ready: true,
      muted: true,
    };
    expect(
      voiceParticipantsSchema.safeParse({ roomId, participants: [participant] })
        .success,
    ).toBe(true);
    expect(
      voiceParticipantsSchema.safeParse({
        roomId,
        participants: [participant, participant],
      }).success,
    ).toBe(false);
    expect(
      voiceParticipantsSchema.safeParse({
        roomId,
        participants: Array(5).fill(participant),
      }).success,
    ).toBe(false);
    expect(
      voiceParticipantsSchema.safeParse({
        roomId,
        participants: [{ ...participant, socketId: 'private' }],
      }).success,
    ).toBe(false);
  });
  it('strictly parses server-derived sender fields without secrets', () => {
    const response = {
      roomId,
      senderId: id,
      senderVoiceId: id,
      targetVoiceId: id,
      sdp,
    };
    expect(voiceServerSchemas['voice:offer'].safeParse(response).success).toBe(
      true,
    );
    expect(
      voiceServerSchemas['voice:offer'].safeParse({
        ...response,
        reconnectToken: 'secret',
      }).success,
    ).toBe(false);
    expect(
      voiceResultSchema.safeParse({
        ok: false,
        error: { code: 'INVALID_PAYLOAD', sdp },
      }).success,
    ).toBe(false);
  });
});
