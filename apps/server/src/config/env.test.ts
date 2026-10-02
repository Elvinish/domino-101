import { describe, expect, it } from 'vitest';
import { parseServerEnv } from './env.js';

describe('server environment', () => {
  it.each([
    'not-a-url',
    'https://example.com/path',
    'https://user:secret@example.com',
    'ftp://example.com',
  ])('rejects invalid browser origin %s', (WEB_ORIGIN) => {
    expect(() => parseServerEnv({ WEB_ORIGIN })).toThrow('WEB_ORIGIN');
  });

  it('supplies local development defaults', () => {
    expect(parseServerEnv({})).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      WEB_ORIGIN: 'http://localhost:5173',
      PORT: 3001,
      LOG_LEVEL: 'info',
      PERSISTENCE_MODE: 'memory',
    });
  });
  it('parses valid overrides and ignores unrelated environment variables', () => {
    expect(
      parseServerEnv({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '8080',
        LOG_LEVEL: 'warn',
        PERSISTENCE_MODE: 'postgres',
        DATABASE_URL: 'postgresql://user:secret@localhost:5432/domino',
        UNRELATED: 'ignored',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      WEB_ORIGIN: 'http://localhost:5173',
      PORT: 8080,
      LOG_LEVEL: 'warn',
      PERSISTENCE_MODE: 'postgres',
      DATABASE_URL: 'postgresql://user:secret@localhost:5432/domino',
    });
  });
  it.each(['', '0', '-1', '65536', '3.14', 'not-a-port'])(
    'rejects invalid port %j',
    (PORT) => {
      expect(() => parseServerEnv({ PORT })).toThrow('PORT');
    },
  );
  it.each([{ NODE_ENV: 'prod' }, { HOST: ' ' }, { LOG_LEVEL: 'verbose' }])(
    'rejects invalid settings %j',
    (input) => {
      expect(() => parseServerEnv(input)).toThrow('Invalid server environment');
    },
  );
  it('requires a PostgreSQL URL in persistent mode without echoing it', () => {
    expect(() => parseServerEnv({ PERSISTENCE_MODE: 'postgres' })).toThrow(
      'DATABASE_URL',
    );
    expect(
      parseServerEnv({
        PERSISTENCE_MODE: 'postgres',
        DATABASE_URL: 'postgresql://user:secret@localhost:5432/domino',
      }),
    ).toMatchObject({ PERSISTENCE_MODE: 'postgres' });
  });
  it('rejects production memory mode', () => {
    expect(() =>
      parseServerEnv({ NODE_ENV: 'production', PERSISTENCE_MODE: 'memory' }),
    ).toThrow('PERSISTENCE_MODE');
  });
  it('does not expose rejected values or other secrets in errors', () => {
    let message = '';
    try {
      parseServerEnv({
        PORT: 'private-value',
        DATABASE_URL: 'private-database-url',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toBe('Invalid server environment: PORT, DATABASE_URL');
    expect(message).not.toContain('private');
  });
});
