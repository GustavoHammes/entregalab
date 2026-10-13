import { randomUUID } from 'node:crypto';

import { query, withTransaction } from '../../db/pool.js';

export type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: Date;
  is_demo: boolean;
};

export type MembershipRow = {
  project_id: string;
  project_name: string;
  role: 'leader' | 'member';
};

type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
};

export async function findUserByEmail(email: string) {
  const result = await query<UserRow>(
    `SELECT id, name, email, password_hash, created_at, is_demo
     FROM users
     WHERE email = $1`,
    [email]
  );

  return result.rows[0] ?? null;
}

export async function findUserById(id: string) {
  const result = await query<UserRow>(
    `SELECT id, name, email, password_hash, created_at, is_demo
     FROM users
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function createUserWithStarterProject(input: CreateUserInput) {
  return withTransaction(async (client) => {
    const userResult = await client.query<UserRow>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, password_hash, created_at, is_demo`,
      [input.name, input.email, input.passwordHash]
    );

    const user = userResult.rows[0];
    const projectSlug = `entrega-de-semestre-${randomUUID().slice(0, 8)}`;

    const projectResult = await client.query<{ id: string }>(
      `INSERT INTO projects (name, slug, description, sprint_start, sprint_end, created_by)
       VALUES (
         'Entrega de Semestre',
         $1,
         'Projeto inicial para organizar entregas academicas por sprint.',
         current_date,
         current_date + interval '21 days',
         $2
       )
       RETURNING id`,
      [projectSlug, user.id]
    );

    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, 'leader')`,
      [projectResult.rows[0].id, user.id]
    );

    return user;
  });
}

export async function listMembershipsForUser(userId: string) {
  const result = await query<MembershipRow>(
    `SELECT
       p.id AS project_id,
       p.name AS project_name,
       pm.role
     FROM project_members pm
     INNER JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = $1
     ORDER BY p.created_at DESC`,
    [userId]
  );

  return result.rows;
}
