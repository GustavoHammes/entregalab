import { randomUUID } from 'node:crypto';

import { query, withTransaction } from '../../db/pool.js';
import { notifyProject } from '../notifications/notification.repository.js';

export type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sprint_start: Date | string | null;
  sprint_end: Date | string | null;
  role: 'leader' | 'member';
  task_count: number;
  member_count: number;
  is_demo: boolean;
  completed_count?: number;
};

type CreateProjectInput = {
  name: string;
  description?: string;
  sprintStart?: string;
  sprintEnd?: string;
  userId: string;
};

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return `${slug || 'project'}-${randomUUID().slice(0, 8)}`;
}

export function toProjectResponse(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sprintStart: row.sprint_start ? new Date(row.sprint_start).toISOString().slice(0, 10) : null,
    sprintEnd: row.sprint_end ? new Date(row.sprint_end).toISOString().slice(0, 10) : null,
    role: row.role,
    taskCount: Number(row.task_count),
    memberCount: Number(row.member_count),
    isDemo: row.is_demo,
    completedCount: Number(row.completed_count ?? 0)
  };
}

export async function listProjectsForUser(userId: string) {
  const result = await query<ProjectRow>(
    `SELECT
       p.id,
       p.name,
       p.slug,
       p.description,
       p.is_demo,
       p.sprint_start,
       p.sprint_end,
       pm.role,
       (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
       (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS completed_count,
       (SELECT count(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count
     FROM project_members pm
     INNER JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = $1
     ORDER BY p.updated_at DESC`,
    [userId]
  );

  return result.rows.map(toProjectResponse);
}

export async function createProject(input: CreateProjectInput) {
  return withTransaction(async (client) => {
    const result = await client.query<ProjectRow>(
      `INSERT INTO projects (name, slug, description, sprint_start, sprint_end, created_by, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT is_demo FROM users WHERE id = $6))
       RETURNING
         id,
         name,
         slug,
         description,
         is_demo,
         sprint_start,
         sprint_end,
         'leader'::project_role AS role,
         0::int AS task_count,
         1::int AS member_count`,
      [
        input.name,
        slugify(input.name),
        input.description ?? null,
        input.sprintStart ?? null,
        input.sprintEnd ?? null,
        input.userId
      ]
    );

    const project = result.rows[0];

    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, 'leader')`,
      [project.id, input.userId]
    );
    await notifyProject(client, { projectId: project.id, kind: 'project', title: 'Projeto criado', body: project.name });

    return toProjectResponse(project);
  });
}
