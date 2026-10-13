import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { migrateDatabase } from './db/migrations.js';
import { startMaintenance } from './modules/maintenance.js';

await migrateDatabase();
const app = await buildApp();
let stopMaintenance: (() => Promise<void>) | undefined;

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down API');
  await app.close();
  await stopMaintenance?.();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({
    host: '0.0.0.0',
    port: env.PORT
  });
  stopMaintenance = startMaintenance(app);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
