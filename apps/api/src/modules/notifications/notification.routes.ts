import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { generateDeadlineReminders, getPreferences, listNotifications, markNotificationsRead } from './notification.repository.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => listNotifications(request.user.sub));
  app.post('/check-deadlines', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => ({ created: await generateDeadlineReminders(request.user.sub) }));
  app.post('/read-all', async (request) => {
    await markNotificationsRead(request.user.sub);
    return { success: true };
  });
  app.patch('/:id/read', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!(await markNotificationsRead(request.user.sub, id)).rowCount) throw new AppError(404, 'NOT_FOUND', 'Notificacao nao encontrada.');
    return { success: true };
  });
  app.get('/preferences', async (request) => ({ preferences: await getPreferences(request.user.sub) }));
  app.patch('/preferences', async (request) => {
    const body = z.object({ projectUpdates: z.boolean(), taskChanges: z.boolean(), dueReminders: z.boolean() }).strict().partial()
      .refine((value) => Object.keys(value).length > 0).parse(request.body);
    await getPreferences(request.user.sub);
    await query(`UPDATE notification_preferences SET project_updates = coalesce($2, project_updates),
      task_changes = coalesce($3, task_changes), due_reminders = coalesce($4, due_reminders) WHERE user_id = $1`,
      [request.user.sub, body.projectUpdates ?? null, body.taskChanges ?? null, body.dueReminders ?? null]);
    return { preferences: await getPreferences(request.user.sub) };
  });
}
