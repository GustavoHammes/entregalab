import { readFile } from 'node:fs/promises';
import { withTransaction } from './pool.js';

export async function migrateDatabase() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(84152001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = await client.query('SELECT version FROM schema_migrations WHERE version = $1', ['001_base']);
    if (!applied.rowCount) {
      // Adopt the original schema without deleting an existing installation.
      const existing = await client.query("SELECT to_regclass('public.users') AS table_name");
      if (!existing.rows[0].table_name) {
        await client.query(await readFile(new URL('../../../../database/schema.sql', import.meta.url), 'utf8'));
      }
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['001_base']);
    }
    const notifications = await client.query('SELECT version FROM schema_migrations WHERE version = $1', ['002_demo_notifications']);
    if (!notifications.rowCount) {
      await client.query(await readFile(new URL('../../../../database/migrations/002_demo_notifications.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['002_demo_notifications']);
    }
    const email = await client.query('SELECT version FROM schema_migrations WHERE version = $1', ['003_email']);
    if (!email.rowCount) {
      await client.query(await readFile(new URL('../../../../database/migrations/003_email.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['003_email']);
    }
    const progress = await client.query('SELECT version FROM schema_migrations WHERE version = $1', ['004_project_progress']);
    if (!progress.rowCount) {
      await client.query(await readFile(new URL('../../../../database/migrations/004_project_progress.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['004_project_progress']);
    }
  });
}
