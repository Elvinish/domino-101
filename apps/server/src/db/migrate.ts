import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PostgresPersistenceStore } from '../persistence/postgres.js';
import { parseServerEnv } from '../config/env.js';

loadEnv({
  path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
  quiet: true,
});

const config = parseServerEnv({ ...process.env, PERSISTENCE_MODE: 'postgres' });
const store = new PostgresPersistenceStore(config.DATABASE_URL!);
try {
  await store.initialize();
} catch {
  console.error(
    'Database migration failed. Check PostgreSQL availability and configuration.',
  );
  process.exitCode = 1;
} finally {
  await store.close();
}
