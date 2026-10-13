import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { PublicUser } from '../../types/auth.js';
import {
  createUserWithStarterProject,
  findUserByEmail,
  findUserById,
  listMembershipsForUser,
  type UserRow
} from './auth.repository.js';
import { loginBodySchema, registerBodySchema } from './auth.schemas.js';

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at.toISOString(),
    isDemo: user.is_demo
  };
}

async function signUserToken(app: FastifyInstance, user: UserRow) {
  return app.jwt.sign({
    sub: user.id,
    email: user.email,
    name: user.name
  });
}

export async function authRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } };
  const cookieOptions = { httpOnly: true, secure: env.SECURE_COOKIES, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 7 };
  app.post('/register', limited, async (request, reply) => {
    const body = registerBodySchema.parse(request.body);
    const existingUser = await findUserByEmail(body.email);

    if (existingUser) {
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'Este email ja esta cadastrado.');
    }

    const passwordHash = await hashPassword(body.password);
    const user = await createUserWithStarterProject({
      name: body.name,
      email: body.email,
      passwordHash
    });

    const token = await signUserToken(app, user);
    reply.setCookie('session', token, cookieOptions);

    return reply.code(201).send({
      user: toPublicUser(user)
    });
  });

  app.post('/login', limited, async (request, reply) => {
    const body = loginBodySchema.parse(request.body);
    const user = await findUserByEmail(body.email);

    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ou senha incorretos.');
    }

    const passwordMatches = await verifyPassword(body.password, user.password_hash);

    if (!passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ou senha incorretos.');
    }

    const token = await signUserToken(app, user);
    reply.setCookie('session', token, cookieOptions);

    return {
      user: toPublicUser(user)
    };
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = await findUserById(request.user.sub);

    if (!user) {
      throw new AppError(401, 'SESSION_USER_NOT_FOUND', 'Authenticated user was not found.');
    }

    const memberships = await listMembershipsForUser(user.id);

    return {
      user: toPublicUser(user),
      memberships
    };
  });

  app.post('/logout', async (_request, reply) => {
    reply.clearCookie('session', { path: '/' });
    return reply.code(204).send();
  });
}
