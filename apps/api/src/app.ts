import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { projectRoutes } from './modules/projects/project.routes.js';
import { taskRoutes } from './modules/tasks/task.routes.js';
import { demoRoutes } from './modules/demo/demo.routes.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { emailRoutes } from './modules/email/email.routes.js';
import { AppError } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';

function getCorsOrigin() {
  return env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
}

export async function buildApp() {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 65536,
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      serializers: { req: (request) => ({ method: request.method, url: request.url?.split('?')[0], hostname: request.hostname }) }
    }
  });

  registerErrorHandler(app);
  await app.register(helmet, { contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], upgradeInsecureRequests: env.SECURE_COOKIES ? [] : null
  } } });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  await app.register(cors, {
    origin: getCorsOrigin(),
    credentials: true
  });

  await app.register(authPlugin);
  app.addHook('onRequest', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    const allowed = env.CORS_ORIGIN.split(',').map((value) => value.trim());
    if (origin && origin !== `${request.protocol}://${request.host}` && !allowed.includes(origin)) {
      throw new AppError(403, 'INVALID_ORIGIN', 'Origem da requisicao nao permitida.');
    }
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(taskRoutes, { prefix: '/api/projects' });
  await app.register(demoRoutes, { prefix: '/api/demo' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(emailRoutes, { prefix: '/api/email' });

  if (env.WEB_DIR) {
    await app.register(staticFiles, { root: resolve(env.WEB_DIR), prefix: '/', wildcard: false,
      cacheControl: false, setHeaders: (reply, path) => { reply.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'); } });
  }
  app.setNotFoundHandler((request, reply) => {
    if (env.WEB_DIR && request.method === 'GET' && !request.url.startsWith('/api/') && request.headers.accept?.includes('text/html')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Recurso nao encontrado.' } });
  });

  return app;
}
