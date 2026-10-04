import { randomUUID } from 'node:crypto';
import { voiceResultSchema } from '@domino/protocol';
import type { VoiceClientEvent } from '@domino/protocol';
import type { Client } from './harness.js';

export const TEST_AUDIO_SDP =
  'v=0\r\ns=private-signaling-fixture\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
export const TEST_ICE = {
  candidate:
    'candidate:private-signaling-fixture 1 udp 1 127.0.0.1 12345 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0 as const,
};
export async function sendVoice(
  client: Client,
  event: VoiceClientEvent,
  payload: unknown,
) {
  const emit = client.socket.timeout(4000).emitWithAck.bind(client.socket) as (
    event: VoiceClientEvent,
    payload: unknown,
  ) => Promise<unknown>;
  return voiceResultSchema.parse(await emit(event, payload));
}
export async function joinVoice(client: Client) {
  const attemptId = randomUUID();
  const roomId = client.joined!.roomId;
  const result = await sendVoice(client, 'voice:join', { roomId, attemptId });
  if (!result.ok || !result.voiceId) throw new Error('Expected voice join');
  const ready = await sendVoice(client, 'voice:ready', {
    roomId,
    voiceId: result.voiceId,
    muted: false,
  });
  if (!ready.ok) throw new Error('Expected voice ready');
  return { voiceId: result.voiceId, attemptId };
}
