import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

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
