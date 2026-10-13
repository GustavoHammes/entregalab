import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from '../../db/pool.js';
import { hashPassword } from '../../lib/password.js';
import { notifyProject } from '../notifications/notification.repository.js';

export async function createDemoUser() {
  const password = await hashPassword(randomBytes(32).toString('hex'));
  return withTransaction(async (client) => (await client.query<{ id: string; name: string; email: string }>(
    `INSERT INTO users (name, email, password_hash, is_demo, demo_expires_at)
     VALUES ('Administrador demo', $1, $2, true, now() + interval '24 hours') RETURNING id, name, email`,
    [`demo-${randomUUID()}@example.invalid`, password])).rows[0]);
}
export async function seedDemoProjects(userId: string, reset = false) {
  const password = await hashPassword(randomBytes(32).toString('hex'));
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('demo:' || $1::text))", [userId]);
    const existing = await client.query<{ id: string }>('SELECT id FROM projects WHERE created_by = $1 AND is_demo ORDER BY created_at', [userId]);
    if (!reset && existing.rowCount) return existing.rows.map((row) => row.id);
    if (reset) {
      await client.query('DELETE FROM projects WHERE created_by = $1 AND is_demo', [userId]);
      await client.query('DELETE FROM users WHERE demo_owner_id = $1', [userId]);
    }
    let members = (await client.query<{ id: string }>('SELECT id FROM users WHERE demo_owner_id = $1 ORDER BY created_at', [userId])).rows;
    if (!members.length) {
      members = [];
      for (const name of ['Marina Costa', 'Lucas Almeida']) {
        const member = await client.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, is_demo, demo_owner_id)
          VALUES ($1, $2, $3, true, $4) RETURNING id`, [name, `member-${randomUUID()}@example.invalid`, password, userId]);
        members.push(member.rows[0]);
      }
    }
    const projects = [
      { name: 'Projeto integrador', description: 'Entrega de semestre: pesquisa, prototipo e apresentacao.', tasks: [
        ['Definir criterios de aceite', 'todo', 'high', 2], ['Reunir referencias da pesquisa', 'todo', 'medium', 5],
        ['Implementar o prototipo', 'in_progress', 'high', 1], ['Preparar roteiro da apresentacao', 'in_progress', 'medium', -1],
        ['Revisar testes com o grupo', 'in_review', 'medium', 3], ['Organizar o repositorio', 'done', 'low', -2]
      ] },
      { name: 'Portal da equipe', description: 'Projeto de trabalho: atendimento, cadastro e relatorios.', tasks: [
        ['Planejar relatorio semanal', 'todo', 'medium', 4], ['Validar requisitos do atendimento', 'todo', 'high', 1],
        ['Conectar cadastro com a API', 'in_progress', 'high', 6], ['Revisar acessibilidade', 'in_review', 'medium', 2],
        ['Publicar ambiente de homologacao', 'done', 'low', -1], ['Documentar o fluxo de suporte', 'done', 'medium', -3]
      ] }
    ];
    const ids: string[] = [];
    for (const fixture of projects) {
      const project = await client.query<{ id: string }>(`INSERT INTO projects (name, slug, description, sprint_start, sprint_end, created_by, is_demo)
        VALUES ($1, $2, $3, (now() AT TIME ZONE 'America/Sao_Paulo')::date,
          (now() AT TIME ZONE 'America/Sao_Paulo')::date + 14, $4, true) RETURNING id`,
        [fixture.name, `lab-${randomUUID()}`, fixture.description, userId]);
      const projectId = project.rows[0].id; ids.push(projectId);
      for (const id of [userId, ...members.map((member) => member.id)]) {
        await client.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [projectId, id, id === userId ? 'leader' : 'member']);
      }
      for (const [index, [title, status, priority, offset]] of fixture.tasks.entries()) {
        const task = await client.query<{ id: string }>(`INSERT INTO tasks (project_id, title, description, status, priority, due_date, position, created_by)
          VALUES ($1, $2, $3, $4, $5, (now() AT TIME ZONE 'America/Sao_Paulo')::date + $6::integer, $7, $8) RETURNING id`,
          [projectId, title, 'Conferir o checklist de aceite e registrar o resultado com a equipe.', status, priority, offset, index, userId]);
        const assignee = [userId, ...members.map((member) => member.id)][index % 3];
        await client.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [task.rows[0].id, assignee]);
        if (status === 'in_review') {
          await client.query('INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3)', [task.rows[0].id, members[0].id, 'Checklist revisado. Falta validar com a equipe antes de concluir.']);
          await notifyProject(client, { projectId, taskId: task.rows[0].id, actorId: members[0].id, kind: 'task', title: 'Tarefa em revisao', body: `Marina colocou "${title}" em revisao.` });
        }
      }
      await notifyProject(client, { projectId, kind: 'project', title: 'Projeto de teste pronto', body: `${fixture.name}: equipe, tarefas e prazos cadastrados.` });
    }
    return ids;
  });
}
export async function cleanupExpiredDemos() {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(84152002)');
    const expired = await client.query<{ id: string }>('SELECT id FROM users WHERE is_demo AND demo_expires_at <= now() FOR UPDATE');
    const ids = expired.rows.map((row) => row.id);
    if (ids.length) {
      await client.query('DELETE FROM projects WHERE created_by = ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    return ids.length;
  });
}
