import { z } from 'zod';
import {
  createRoomSchema,
  errorCodeSchema,
  playerIdSchema,
  roomIdSchema,
  seatSchema,
} from './multiplayer.js';

export const VOICE_CLIENT_EVENTS = {
  join: 'voice:join',
  ready: 'voice:ready',
  offer: 'voice:offer',
  answer: 'voice:answer',
  ice: 'voice:ice',
  leave: 'voice:leave',
  state: 'voice:state',
} as const;
export const VOICE_SERVER_EVENTS = {
  participants: 'voice:participants',
  joined: 'voice:peer-joined',
  ready: 'voice:peer-ready',
  offer: 'voice:offer',
  answer: 'voice:answer',
  ice: 'voice:ice',
  left: 'voice:peer-left',
  state: 'voice:state',
} as const;
// attemptId cancels a pending join; it is correlation, never proof of player identity.
export const voiceJoinSchema = z.strictObject({
  roomId: roomIdSchema,
  attemptId: z.uuid(),
});
export const voiceLeaveSchema = voiceJoinSchema;
export const voiceStateSchema = z.strictObject({
  roomId: roomIdSchema,
  voiceId: z.uuid(),
  muted: z.boolean(),
});
export const voiceReadySchema = voiceStateSchema;
export const voiceParticipantSchema = z.strictObject({
  playerId: playerIdSchema,
  seat: seatSchema,
  displayName: createRoomSchema.shape.displayName,
  voiceId: z.uuid(),
  ready: z.boolean(),
  muted: z.boolean(),
});
export const voiceParticipantsSchema = z
  .strictObject({
    roomId: roomIdSchema,
    participants: z.array(voiceParticipantSchema).max(4),
  })
  .refine(
    ({ participants }) =>
      new Set(participants.map((p) => p.playerId)).size ===
        participants.length &&
      new Set(participants.map((p) => p.seat)).size === participants.length,
  );
export const voicePeerSchema = z.strictObject({
  roomId: roomIdSchema,
  participant: voiceParticipantSchema,
});
export const voicePeerLeftSchema = z.strictObject({
  roomId: roomIdSchema,
  playerId: playerIdSchema,
  voiceId: z.uuid(),
});
// One audio m-line; reject video/data channels. Browsers validate SDP semantics.
export const voiceSdpSchema = z
  .string()
  .min(1)
  .max(6000)
  .refine((sdp) => {
    const media = sdp.split(/\r?\n/).filter((line) => line.startsWith('m='));
    return (
      /^v=0\r?\n/.test(sdp) &&
      !/\r(?!\n)/.test(sdp) &&
      media.length === 1 &&
      media[0]!.startsWith('m=audio ')
    );
  });
export const voiceCandidateSchema = z
  .strictObject({
    candidate: z
      .string()
      .max(2048)
      .refine((value) => value === '' || value.startsWith('candidate:')),
    sdpMid: z.string().max(32).nullable(),
    sdpMLineIndex: z.literal(0).nullable(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .nullable();
const target = {
  roomId: roomIdSchema,
  voiceId: z.uuid(),
  targetId: playerIdSchema,
  targetVoiceId: z.uuid(),
};
export const voiceOfferSchema = z.strictObject({
  ...target,
  sdp: voiceSdpSchema,
});
export const voiceAnswerSchema = voiceOfferSchema;
export const voiceIceSchema = z.strictObject({
  ...target,
  candidate: voiceCandidateSchema,
});
const sender = {
  roomId: roomIdSchema,
  senderId: playerIdSchema,
  senderVoiceId: z.uuid(),
  targetVoiceId: z.uuid(),
};
export const voiceDescriptionReceivedSchema = z.strictObject({
  ...sender,
  sdp: voiceSdpSchema,
});
export const voiceIceReceivedSchema = z.strictObject({
  ...sender,
  candidate: voiceCandidateSchema,
});
export const voiceResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), voiceId: z.uuid().optional() }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: errorCodeSchema }),
  }),
]);
export const voiceClientSchemas = {
  'voice:join': voiceJoinSchema,
  'voice:ready': voiceReadySchema,
  'voice:offer': voiceOfferSchema,
  'voice:answer': voiceAnswerSchema,
  'voice:ice': voiceIceSchema,
  'voice:leave': voiceLeaveSchema,
  'voice:state': voiceStateSchema,
} as const;
export const voiceServerSchemas = {
  'voice:participants': voiceParticipantsSchema,
  'voice:peer-joined': voicePeerSchema,
  'voice:peer-ready': voicePeerSchema,
  'voice:state': voicePeerSchema,
  'voice:peer-left': voicePeerLeftSchema,
  'voice:offer': voiceDescriptionReceivedSchema,
  'voice:answer': voiceDescriptionReceivedSchema,
  'voice:ice': voiceIceReceivedSchema,
} as const;
export type VoiceJoin = z.infer<typeof voiceJoinSchema>;
export type VoiceState = z.infer<typeof voiceStateSchema>;
export type VoiceParticipant = z.infer<typeof voiceParticipantSchema>;
export type VoiceParticipants = z.infer<typeof voiceParticipantsSchema>;
export type VoiceOffer = z.infer<typeof voiceOfferSchema>;
export type VoiceIce = z.infer<typeof voiceIceSchema>;
export type VoiceDescriptionReceived = z.infer<
  typeof voiceDescriptionReceivedSchema
>;
export type VoiceIceReceived = z.infer<typeof voiceIceReceivedSchema>;
export type VoiceCandidate = z.infer<typeof voiceCandidateSchema>;
export type VoiceResult = z.infer<typeof voiceResultSchema>;
export type VoiceClientEvent = keyof typeof voiceClientSchemas;
export type VoiceServerEvent = keyof typeof voiceServerSchemas;
export type VoiceRequests = {
  [E in VoiceClientEvent]: z.infer<(typeof voiceClientSchemas)[E]>;
};
export type VoiceResponses = {
  [E in VoiceServerEvent]: z.infer<(typeof voiceServerSchemas)[E]>;
};
export type VoiceClientEvents = {
  [E in VoiceClientEvent]: (
    payload: VoiceRequests[E],
    ack?: (value: VoiceResult) => void,
  ) => void;
};
export type VoiceServerEvents = {
  [E in VoiceServerEvent]: (payload: VoiceResponses[E]) => void;
};
