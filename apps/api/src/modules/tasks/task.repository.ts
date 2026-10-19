import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { taskFields } from './task.schemas.js';
import { notifyProject } from '../notifications/notification.repository.js';
import { lockProject } from '../projects/project.access.js';

type TaskInput = z.infer<typeof taskFields>;
const statusNames = { todo: 'A fazer', in_progress: 'Em andamento', in_review: 'Em revisao', done: 'Concluido' };
type TaskRow = { id: string; project_id: string; title: string; description: string | null; status: TaskInput['status'];
  priority: TaskInput['priority']; due_date: string | null; position: string; created_at: Date; updated_at: Date;
  assignee_id: string | null; comment_count: number };
const taskSelect = `SELECT t.*, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
  (SELECT user_id FROM task_assignees a WHERE a.task_id = t.id ORDER BY assigned_at LIMIT 1) AS assignee_id,
  (SELECT count(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count FROM tasks t`;
export function toTask(row: TaskRow) {
  return { id: row.id, projectId: row.project_id, title: row.title, description: row.description ?? '', status: row.status,
    priority: row.priority, dueDate: row.due_date, position: Number(row.position), assigneeId: row.assignee_id,
    comments: Number(row.comment_count), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
export async function listTasks(projectId: string) {
  const result = await query<TaskRow>(`${taskSelect} WHERE t.project_id = $1 ORDER BY t.position, t.created_at, t.id`, [projectId]);
  return result.rows.map(toTask);
}
async function getTask(client: PoolClient, projectId: string, taskId: string) {
  const result = await client.query<TaskRow>(`${taskSelect} WHERE t.project_id = $1 AND t.id = $2`, [projectId, taskId]);
  if (!result.rows[0]) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa nao encontrada.');
  return toTask(result.rows[0]);
}
async function assign(client: PoolClient, projectId: string, taskId: string, assigneeId: string | null) {
  if (assigneeId) {
    const member = await client.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, assigneeId]);
    if (!member.rowCount) throw new AppError(400, 'INVALID_ASSIGNEE', 'O responsavel precisa fazer parte do projeto.');
  }
  await client.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
  if (assigneeId) await client.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [taskId, assigneeId]);
}
export async function createTask(projectId: string, userId: string, input: TaskInput) {
  return withTransaction(async (client) => {
    await lockProject(client, projectId, userId);
    const result = await client.query<{ id: string }>(`INSERT INTO tasks (project_id, title, description, status, priority, due_date, position, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(max(position), -1) + 1 FROM tasks WHERE project_id = $1 AND status = $4), $7) RETURNING id`,
      [projectId, input.title, input.description, input.status, input.priority, input.dueDate, userId]);
    const id = result.rows[0].id;
    await assign(client, projectId, id, input.assigneeId);
    await notifyProject(client, { projectId, taskId: id, actorId: userId, kind: 'task', title: 'Nova tarefa', body: input.title });
    return getTask(client, projectId, id);
  });
}
export async function editTask(projectId: string, taskId: string, userId: string, input: Partial<TaskInput>) {
  return withTransaction(async (client) => {
    await lockProject(client, projectId, userId);
    const task = await getTask(client, projectId, taskId);
    const next = { ...task, ...input };
    const position = task.status !== next.status ? await client.query<{ position: string }>(
      'SELECT coalesce(max(position), -1) + 1 AS position FROM tasks WHERE project_id = $1 AND status = $2', [projectId, next.status]) : null;
    await client.query(`UPDATE tasks SET title = $3, description = $4, status = $5, priority = $6, due_date = $7, position = $8
      WHERE project_id = $1 AND id = $2`, [projectId, taskId, next.title, next.description, next.status, next.priority, next.dueDate, position ? position.rows[0].position : task.position]);
    if ('assigneeId' in input) await assign(client, projectId, taskId, input.assigneeId ?? null);
    await notifyProject(client, { projectId, taskId, actorId: userId, kind: 'task', title: task.status !== next.status ? 'Status atualizado' : 'Tarefa atualizada', body: `${next.title} - ${statusNames[next.status]}` });
    if (next.status === 'done') await client.query("UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE task_id = $1 AND kind = 'due'", [taskId]);
    return getTask(client, projectId, taskId);
  });
}
export async function removeTask(projectId: string, taskId: string, userId: string) {
  await withTransaction(async (client) => {
    await lockProject(client, projectId, userId);
    const task = await getTask(client, projectId, taskId);
    const result = await client.query('DELETE FROM tasks WHERE project_id = $1 AND id = $2 RETURNING id', [projectId, taskId]);
    if (!result.rowCount) throw new AppError(404, 'TASK_NOT_FOUND', 'Tarefa nao encontrada.');
    await notifyProject(client, { projectId, actorId: userId, kind: 'task', title: 'Tarefa excluida', body: task.title });
  });
}
export async function moveTask(projectId: string, taskId: string, userId: string, status: TaskInput['status'], beforeId: string | null) {
  return withTransaction(async (client) => {
    await lockProject(client, projectId, userId);
    const task = await getTask(client, projectId, taskId);
    const result = await client.query<{ id: string }>('SELECT id FROM tasks WHERE project_id = $1 AND status = $2 AND id <> $3 ORDER BY position, created_at, id', [projectId, status, taskId]);
    const ids = result.rows.map((row) => row.id);
    const index = beforeId ? ids.indexOf(beforeId) : ids.length;
    if (index < 0) throw new AppError(400, 'INVALID_POSITION', 'A tarefa de destino precisa estar na mesma coluna.');
    ids.splice(index, 0, taskId);
    await client.query('UPDATE tasks SET status = $3 WHERE project_id = $1 AND id = $2', [projectId, taskId, status]);
    for (const [position, id] of ids.entries()) {
      await client.query('UPDATE tasks SET position = $3 WHERE project_id = $1 AND id = $2', [projectId, id, position]);
    }
    if (task.status !== status) await notifyProject(client, { projectId, taskId, actorId: userId, kind: 'task', title: 'Tarefa movimentada', body: `${task.title}: ${statusNames[task.status]} > ${statusNames[status]}` });
    if (status === 'done') await client.query("UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE task_id = $1 AND kind = 'due'", [taskId]);
    return getTask(client, projectId, taskId);
  });
}
export async function listComments(projectId: string, taskId: string) {
  return withTransaction(async (client) => {
    await getTask(client, projectId, taskId);
    return (await client.query(`SELECT c.id, c.body, c.created_at AS "createdAt", u.name AS "authorName"
      FROM comments c JOIN users u ON u.id = c.author_id WHERE c.task_id = $1 ORDER BY c.created_at`, [taskId])).rows;
  });
}
export async function addComment(projectId: string, taskId: string, userId: string, body: string) {
  return withTransaction(async (client) => {
    await lockProject(client, projectId, userId);
    await getTask(client, projectId, taskId);
    await notifyProject(client, { projectId, taskId, actorId: userId, kind: 'task', title: 'Novo comentario', body: body.slice(0, 500) });
    return (await client.query('INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id', [taskId, userId, body])).rows[0];
  });
}
