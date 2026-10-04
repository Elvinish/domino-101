import { describe, expect, it } from 'vitest';
import { parseWebEnv, parseIceServers } from './env';

describe('web environment', () => {
  it('defaults to the local API', () => {
    expect(parseWebEnv({}).VITE_API_BASE_URL).toBe('http://localhost:3001');
  });
  it('accepts an HTTPS API URL', () => {
    expect(
      parseWebEnv({ VITE_API_BASE_URL: 'https://api.example.com' })
        .VITE_API_BASE_URL,
    ).toBe('https://api.example.com');
  });
  it.each([
    '',
    'not-a-url',
    'ftp://example.com',
    'https://user:password@example.com',
    'https://example.com?token=secret',
    'https://example.com#secret',
  ])('rejects unsafe or malformed URLs %j', (VITE_API_BASE_URL) => {
    expect(() => parseWebEnv({ VITE_API_BASE_URL })).toThrow(
      'Invalid web environment: VITE_API_BASE_URL',
    );
  });
});

describe('public ICE configuration', () => {
  it('uses STUN by default and allows host-only local testing', () => {
    expect(parseWebEnv({}).VITE_WEBRTC_ICE_SERVERS).toEqual([
      { urls: ['stun:stun.l.google.com:19302'] },
    ]);
    expect(parseIceServers('[]')).toEqual([]);
  });
  it('accepts configured STUN and authenticated TURN/TURNS without hidden defaults', () => {
    const config = [
      { urls: 'stun:stun.example.com:3478' },
      {
        urls: [
          'turn:relay.example.com:3478?transport=udp',
          'turns:relay.example.com:5349?transport=tcp',
        ],
        username: 'temporary-user',
        credential: 'temporary-value',
      },
    ];
    expect(parseIceServers(JSON.stringify(config))).toEqual(config);
  });
  it.each([
    'not json',
    '{}',
    '[{"urls":"https://example.com"}]',
    '[{"urls":"turn:relay.example.com"}]',
    '[{"urls":"stun:user:secret@example.com"}]',
    '[{"urls":"stun:example.com/path"}]',
    '[{"urls":"stun:example.com:99999"}]',
    '[{"urls":"stun:example.com","unexpected":"secret"}]',
  ])(
    'rejects invalid ICE configuration without exposing values %#',
    (value) => {
      expect(() => parseIceServers(value)).toThrow(
        'Invalid web environment: VITE_WEBRTC_ICE_SERVERS',
      );
    },
  );
});
