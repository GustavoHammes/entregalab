import { query } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

export async function requireMembership(projectId: string, userId: string, leader = false) {
  const result = await query<{ role: 'leader' | 'member' }>(
    'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]
  );
  const member = result.rows[0];
  if (!member) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Projeto nao encontrado.');
  if (leader && member.role !== 'leader') throw new AppError(403, 'LEADER_REQUIRED', 'Somente o lider pode alterar o projeto e a equipe.');
  return member.role;
}
