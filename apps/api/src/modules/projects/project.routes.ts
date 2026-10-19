import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { lockProject, requireMembership } from './project.access.js';
import { projectParams } from '../tasks/task.schemas.js';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../lib/password.js';
import { notifyProject } from '../notifications/notification.repository.js';

import { createProject, listProjectsForUser } from './project.repository.js';
import { createProjectBodySchema } from './project.schemas.js';
import { projectProgress } from './project.progress.js';

export async function projectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    return {
      projects: await listProjectsForUser(request.user.sub)
    };
  });

  app.post('/', async (request, reply) => {
    const body = createProjectBodySchema.parse(request.body);
    const project = await createProject({
      ...body,
      userId: request.user.sub
    });

    return reply.code(201).send({ project });
  });

  app.get('/:projectId/progress', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const { days } = z.object({ days: z.enum(['7', '30', '90']).default('30') }).parse(request.query);
    await requireMembership(projectId, request.user.sub);
    return projectProgress(projectId, Number(days));
  });

  app.patch('/:projectId', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    await requireMembership(projectId, request.user.sub, true);
    const body = createProjectBodySchema.parse(request.body);
    await withTransaction(async (client) => {
      await lockProject(client, projectId, request.user.sub, true);
      await client.query('UPDATE projects SET name = $2, description = $3, sprint_start = $4, sprint_end = $5 WHERE id = $1',
        [projectId, body.name, body.description ?? null, body.sprintStart ?? null, body.sprintEnd ?? null]);
      await notifyProject(client, { projectId, actorId: request.user.sub, kind: 'project', title: 'Projeto atualizado', body: body.name });
    });
    return { project: (await listProjectsForUser(request.user.sub)).find((project) => project.id === projectId) };
  });
  app.delete('/:projectId', async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    await requireMembership(projectId, request.user.sub, true);
    await withTransaction(async (client) => {
      await lockProject(client, projectId, request.user.sub, true);
      await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
    });
    return reply.code(204).send();
  });
  app.get('/:projectId/members', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    await requireMembership(projectId, request.user.sub);
    const result = await query(`SELECT u.id, u.name, u.email, pm.role FROM project_members pm
      JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY pm.role, u.name`, [projectId]);
    return { members: result.rows };
  });
  app.post('/:projectId/members', async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    await requireMembership(projectId, request.user.sub, true);
    const project = (await query<{ is_demo: boolean }>('SELECT is_demo FROM projects WHERE id = $1', [projectId])).rows[0];
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Projeto nao encontrado.');
    const body = project.is_demo ? z.object({ name: z.string().trim().min(2).max(120) }).strict().parse(request.body)
      : z.object({ email: z.string().trim().email() }).strict().parse(request.body);
    const password = project.is_demo ? await hashPassword(randomUUID()) : null;
    await withTransaction(async (client) => {
      await lockProject(client, projectId, request.user.sub, true);
      const user = 'name' in body ? await client.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, is_demo, demo_owner_id)
        VALUES ($1, $2, $3, $4, $5) RETURNING id`, [body.name, `member-${randomUUID()}@example.invalid`, password, true, request.user.sub])
        : await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1 AND NOT is_demo', [body.email]);
      if (!user.rowCount) throw new AppError(404, 'USER_NOT_FOUND', 'Esta pessoa precisa criar uma conta antes de entrar no projeto.');
      await client.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')", [projectId, user.rows[0].id]);
      await notifyProject(client, { projectId, actorId: request.user.sub, kind: 'project', title: 'Novo membro na equipe', body: 'A equipe do projeto foi atualizada.' });
    });
    return reply.code(201).send({ success: true });
  });
  app.delete('/:projectId/members/:userId', async (request, reply) => {
    const { projectId, userId } = projectParams.extend({ userId: z.string().uuid() }).parse(request.params);
    await requireMembership(projectId, request.user.sub, true);
    await withTransaction(async (client) => {
      await lockProject(client, projectId, request.user.sub, true);
      const member = await client.query('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      if (!member.rowCount) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Membro nao encontrado.');
      if (member.rows[0].role === 'leader') throw new AppError(400, 'LEADER_REMOVAL', 'O lider do projeto nao pode ser removido.');
      await client.query('DELETE FROM task_assignees a USING tasks t WHERE a.task_id = t.id AND t.project_id = $1 AND a.user_id = $2', [projectId, userId]);
      await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await notifyProject(client, { projectId, actorId: request.user.sub, kind: 'project', title: 'Equipe atualizada', body: 'Um membro foi removido do projeto.' });
    });
    return reply.code(204).send();
  });
}
