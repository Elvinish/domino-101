import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@domino/protocol';
import { createApp } from './app.js';
import { parseServerEnv } from './config/env.js';

describe('HTTP foundation', () => {
  const apps: ReturnType<typeof createApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  function setup() {
    const app = createApp(parseServerEnv({ LOG_LEVEL: 'silent' }));
    apps.push(app);
    return app;
  }
  it('serves a public health response matching the shared contract', async () => {
    const response = await setup().inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
    });
    expect(Object.keys(response.json() as object)).toEqual(['status']);
  });
  it('returns 404 for unimplemented endpoints', async () => {
    const response = await setup().inject({ method: 'GET', url: '/rooms' });
    expect(response.statusCode).toBe(404);
  });
  it('does not accept mutation requests on health', async () => {
    const response = await setup().inject({ method: 'POST', url: '/health' });
    expect(response.statusCode).toBe(404);
  });
});
