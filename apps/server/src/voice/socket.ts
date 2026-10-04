import type { Socket } from 'socket.io';
import {
  serverErrorSchema,
  voiceClientSchemas,
  voiceResultSchema,
} from '@domino/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  VoiceClientEvent,
  VoiceResult,
} from '@domino/protocol';
import type { z } from 'zod';
import { errorCode } from '../rooms/errors.js';
import type { VoiceService } from './service.js';

export function attachVoice(
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  voice: VoiceService,
): void {
  const connection = { id: socket.id, isConnected: () => socket.connected };
  let startedAt = Date.now(),
    count = 0;
  async function handle<T>(
    event: VoiceClientEvent,
    schema: z.ZodType<T>,
    raw: unknown,
    ack: unknown,
    action: (payload: T) => Promise<VoiceResult>,
  ): Promise<void> {
    let result: VoiceResult;
    try {
      if (Date.now() - startedAt >= 10_000) {
        startedAt = Date.now();
        count = 0;
      }
      const parsed = schema.safeParse(raw);
      if (++count > 240 && event !== 'voice:leave')
        result = { ok: false, error: { code: 'SERVER_BUSY' } };
      else if (!parsed.success)
        result = { ok: false, error: { code: 'INVALID_PAYLOAD' } };
      else result = await action(parsed.data);
    } catch (error) {
      result = { ok: false, error: { code: errorCode(error) } };
    }
    result = voiceResultSchema.parse(result);
    if (!result.ok)
      socket.emit(
        'server:error',
        serverErrorSchema.parse({ event, code: result.error.code }),
      );
    if (typeof ack === 'function') ack(result);
  }
  // Never log payloads, SDP, ICE, validation issues or raw exceptions.
  const safe = (operation: Promise<void>) => {
    void operation.catch(() => undefined);
  };
  socket.on('voice:join', (raw, ack) =>
    safe(
      handle(
        'voice:join',
        voiceClientSchemas['voice:join'],
        raw,
        ack,
        (payload) => voice.join(connection, payload),
      ),
    ),
  );
  socket.on('voice:ready', (raw, ack) =>
    safe(
      handle(
        'voice:ready',
        voiceClientSchemas['voice:ready'],
        raw,
        ack,
        (payload) => voice.state(connection, payload, true),
      ),
    ),
  );
  socket.on('voice:state', (raw, ack) =>
    safe(
      handle(
        'voice:state',
        voiceClientSchemas['voice:state'],
        raw,
        ack,
        (payload) => voice.state(connection, payload),
      ),
    ),
  );
  socket.on('voice:offer', (raw, ack) =>
    safe(
      handle(
        'voice:offer',
        voiceClientSchemas['voice:offer'],
        raw,
        ack,
        (payload) => voice.signal(connection, 'voice:offer', payload),
      ),
    ),
  );
  socket.on('voice:answer', (raw, ack) =>
    safe(
      handle(
        'voice:answer',
        voiceClientSchemas['voice:answer'],
        raw,
        ack,
        (payload) => voice.signal(connection, 'voice:answer', payload),
      ),
    ),
  );
  socket.on('voice:ice', (raw, ack) =>
    safe(
      handle(
        'voice:ice',
        voiceClientSchemas['voice:ice'],
        raw,
        ack,
        (payload) => voice.signal(connection, 'voice:ice', payload),
      ),
    ),
  );
  socket.on('voice:leave', (raw, ack) =>
    safe(
      handle(
        'voice:leave',
        voiceClientSchemas['voice:leave'],
        raw,
        ack,
        (payload) => voice.leave(connection, payload),
      ),
    ),
  );
}
