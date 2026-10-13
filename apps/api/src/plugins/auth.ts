import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { query } from '../db/pool.js';

async function authPluginImpl(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN
    },
    cookie: { cookieName: 'session', signed: false }
  });

  app.decorate('authenticate', async (request, _reply) => {
    try {
      await request.jwtVerify();
      const user = await query('SELECT id FROM users WHERE id = $1 AND (demo_expires_at IS NULL OR demo_expires_at > now())', [request.user.sub]);
      if (!user.rowCount) throw new Error('Expired session');
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
    }
  });
}

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin'
});
