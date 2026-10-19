import type { PoolClient } from 'pg';
import { query } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

export async function requireMembership(projectId: string, userId: string, leader = false, client?: PoolClient) {
  const sql = 'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2';
  const params = [projectId, userId];
  const result = client ? await client.query<{ role: 'leader' | 'member' }>(sql, params)
    : await query<{ role: 'leader' | 'member' }>(sql, params);
  const member = result.rows[0];
  if (!member) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Projeto nao encontrado.');
  if (leader && member.role !== 'leader') throw new AppError(403, 'LEADER_REQUIRED', 'Somente o lider pode alterar o projeto e a equipe.');
  return member.role;
}

export async function lockProject(client: PoolClient, projectId: string, userId: string, leader = false) {
  // Recheck current permissions after acquiring the project-wide write lock.
  const project = await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
  if (!project.rowCount) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Projeto nao encontrado.');
  return requireMembership(projectId, userId, leader, client);
}
