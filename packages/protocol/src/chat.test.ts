import { describe, expect, it } from 'vitest';
import {
  chatCommandSchema,
  chatHistorySchema,
  chatMessageSchema,
  reactionCommandSchema,
  reactionReceivedSchema,
} from './index.js';

const roomId = 'a'.repeat(32);
const id = '00000000-0000-4000-8000-000000000001';
const author = { playerId: id, displayName: 'Guest', seat: 0 as const };
describe('room chat protocol', () => {
  it('accepts strict commands and rejects identity injection', () => {
    expect(
      chatCommandSchema.safeParse({ roomId, commandId: id, text: 'hello' })
        .success,
    ).toBe(true);
    expect(
      chatCommandSchema.safeParse({
        roomId,
        commandId: id,
        text: 'hello',
        playerId: id,
      }).success,
    ).toBe(false);
    expect(
      reactionCommandSchema.safeParse({
        roomId,
        commandId: id,
        reaction: 'fire',
      }).success,
    ).toBe(true);
  });
  it('validates bounded server-authored messages and reactions', () => {
    const message = {
      messageId: id,
      sender: author,
      text: 'hello',
      timestamp: 1,
    };
    expect(chatMessageSchema.safeParse(message).success).toBe(true);
    expect(
      chatMessageSchema.safeParse({ ...message, text: 'x'.repeat(501) })
        .success,
    ).toBe(false);
    expect(
      chatHistorySchema.safeParse({ roomId, messages: [message] }).success,
    ).toBe(true);
    expect(
      reactionReceivedSchema.safeParse({
        reactionId: id,
        sender: author,
        reaction: 'fire',
        timestamp: 1,
      }).success,
    ).toBe(true);
    expect(
      reactionReceivedSchema.safeParse({
        reactionId: id,
        sender: author,
        reaction: 'script',
        timestamp: 1,
      }).success,
    ).toBe(false);
  });
});
