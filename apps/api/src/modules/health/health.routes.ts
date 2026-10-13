import type { FastifyInstance } from 'fastify';

import { query } from '../../db/pool.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    await query('SELECT 1');

    return {
      status: 'ok',
      database: 'ok'
    };
  });
}
