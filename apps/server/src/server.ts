import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createApp } from './app.js';
import { parseServerEnv } from './config/env.js';

// Same relative location from src/server.ts and dist/server.js; shell env wins.
loadEnv({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

async function main(): Promise<void> {
  const config = parseServerEnv(process.env);
  const app = createApp(config);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    try {
      await app.close();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch {
    console.error(
      'Server startup failed. Check PostgreSQL, stored state, configuration and port availability.',
    );
    await shutdown();
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error('Server startup failed. Check environment configuration.');
  process.exitCode = 1;
});
