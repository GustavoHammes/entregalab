import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { createDemoUser, seedDemoProjects } from './demo.repository.js';
import { generateDeadlineReminders } from '../notifications/notification.repository.js';

export async function demoRoutes(app: FastifyInstance) {
  app.post('/session', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (_request, reply) => {
    const user = await createDemoUser();
    const projectIds = await seedDemoProjects(user.id);
    await generateDeadlineReminders(user.id);
    const token = app.jwt.sign({ sub: user.id, name: user.name, email: user.email }, { expiresIn: '24h' });
    reply.setCookie('session', token, { path: '/', httpOnly: true, secure: env.SECURE_COOKIES, sameSite: 'lax', maxAge: 86400 });
    return reply.code(201).send({ user: { ...user, isDemo: true }, projectIds });
  });
  app.post('/projects', { preHandler: app.authenticate }, async (request) => ({ projectIds: await seedDemoProjects(request.user.sub) }));
  app.post('/reset', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const projectIds = await seedDemoProjects(request.user.sub, true);
    await generateDeadlineReminders(request.user.sub);
    return { projectIds };
  });
}
