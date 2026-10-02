import Fastify, { LogController } from 'fastify';
import type { HealthResponse } from '@domino/protocol';
import { attachRealtime } from './realtime/socket.js';
import type { RealtimeOptions } from './realtime/socket.js';
import type { ServerEnv } from './config/env.js';
import { PostgresPersistenceStore } from './persistence/postgres.js';
import type { PersistenceStore } from './persistence/types.js';

export function createApp(config: ServerEnv, options: RealtimeOptions = {}) {
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL },
    // Request URLs and headers may contain sensitive data in later phases.
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['status'],
            additionalProperties: false,
            properties: { status: { type: 'string', const: 'ok' } },
          },
        },
      },
    },
    (): HealthResponse => ({ status: 'ok' }),
  );
  const persistence: PersistenceStore | undefined =
    options.persistence ??
    (config.PERSISTENCE_MODE === 'postgres' && config.DATABASE_URL
      ? new PostgresPersistenceStore(config.DATABASE_URL)
      : undefined);
  const realtimeOptions: RealtimeOptions = { ...options };
  if (persistence) realtimeOptions.persistence = persistence;
  attachRealtime(app, config, realtimeOptions);
  return app;
}
