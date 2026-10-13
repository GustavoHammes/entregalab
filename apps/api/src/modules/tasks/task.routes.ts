import type { FastifyInstance } from 'fastify';
import { requireMembership } from '../projects/project.access.js';
import { addComment, createTask, editTask, listComments, listTasks, moveTask, removeTask } from './task.repository.js';
import { commentBody, moveTaskBody, projectParams, taskFields, taskParams, updateTaskBody } from './task.schemas.js';

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    await requireMembership(projectId, request.user.sub);
  });
  app.get('/:projectId/tasks', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    return { tasks: await listTasks(projectId) };
  });
  app.post('/:projectId/tasks', async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    return reply.code(201).send({ task: await createTask(projectId, request.user.sub, taskFields.parse(request.body)) });
  });
  app.patch('/:projectId/tasks/:taskId', async (request) => {
    const { projectId, taskId } = taskParams.parse(request.params);
    return { task: await editTask(projectId, taskId, request.user.sub, updateTaskBody.parse(request.body)) };
  });
  app.delete('/:projectId/tasks/:taskId', async (request, reply) => {
    const { projectId, taskId } = taskParams.parse(request.params);
    await removeTask(projectId, taskId, request.user.sub);
    return reply.code(204).send();
  });
  app.post('/:projectId/tasks/:taskId/move', async (request) => {
    const { projectId, taskId } = taskParams.parse(request.params);
    const body = moveTaskBody.parse(request.body);
    return { task: await moveTask(projectId, taskId, request.user.sub, body.status, body.beforeId) };
  });
  app.get('/:projectId/tasks/:taskId/comments', async (request) => {
    const { projectId, taskId } = taskParams.parse(request.params);
    return { comments: await listComments(projectId, taskId) };
  });
  app.post('/:projectId/tasks/:taskId/comments', async (request, reply) => {
    const { projectId, taskId } = taskParams.parse(request.params);
    return reply.code(201).send(await addComment(projectId, taskId, request.user.sub, commentBody.parse(request.body).body));
  });
}
