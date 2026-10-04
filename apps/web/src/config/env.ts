import { z } from 'zod';

export const DEFAULT_ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }];
const iceUrlSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => {
    if (!/^(stun|stuns|turn|turns):[^\s/]+$/.test(value)) return false;
    if (/^stuns?:/.test(value) && value.includes('?')) return false;
    try {
      const url = new URL(
        value.replace(/^(stun|stuns|turn|turns):/, 'https://'),
      );
      return (
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !url.hash &&
        url.pathname === '/' &&
        url.port !== '0' &&
        (!url.search || /^\?transport=(udp|tcp)$/.test(url.search))
      );
    } catch {
      return false;
    }
  });
const iceServerSchema = z
  .strictObject({
    urls: z.union([iceUrlSchema, z.array(iceUrlSchema).min(1).max(4)]),
    username: z.string().min(1).max(256).optional(),
    credential: z.string().min(1).max(256).optional(),
  })
  .refine((server) => {
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    return (
      !urls.some((url) => /^turns?:/.test(url)) ||
      (!!server.username && !!server.credential)
    );
  });
export function parseIceServers(value: unknown) {
  if (value === undefined) return DEFAULT_ICE_SERVERS;
  try {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    return z
      .array(iceServerSchema)
      .max(8)
      .parse(JSON.parse(value))
      .map(({ urls, username, credential }) => ({
        urls,
        ...(username === undefined ? {} : { username }),
        ...(credential === undefined ? {} : { credential }),
      }));
  } catch {
    throw new Error('Invalid web environment: VITE_WEBRTC_ICE_SERVERS');
  }
}

const webEnvSchema = z.object({
  VITE_API_BASE_URL: z
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    })
    .default('http://localhost:3001'),
});

export function parseWebEnv(input: Record<string, unknown>) {
  const result = webEnvSchema.safeParse(input);
  if (!result.success)
    throw new Error('Invalid web environment: VITE_API_BASE_URL');
  return {
    ...result.data,
    VITE_WEBRTC_ICE_SERVERS: parseIceServers(input.VITE_WEBRTC_ICE_SERVERS),
  };
}
