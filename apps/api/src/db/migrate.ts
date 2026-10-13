import { migrateDatabase } from './migrations.js';
import { pool } from './pool.js';

try {
  await migrateDatabase();
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
