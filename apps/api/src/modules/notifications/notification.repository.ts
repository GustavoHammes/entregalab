import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';

export type NotificationKind = 'project' | 'task' | 'due';
type Event = { projectId: string; taskId?: string; actorId?: string; kind: NotificationKind; title: string; body: string; dedupeKey?: string };

export async function notifyProject(client: PoolClient, event: Event) {
  const recipients = await client.query<{ user_id: string }>(`SELECT m.user_id FROM project_members m
    LEFT JOIN notification_preferences p ON p.user_id = m.user_id
    WHERE m.project_id = $1 AND ($2::uuid IS NULL OR m.user_id <> $2)
      AND CASE $3 WHEN 'project' THEN coalesce(p.project_updates, true)
                 WHEN 'task' THEN coalesce(p.task_changes, true) ELSE coalesce(p.due_reminders, true) END`,
    [event.projectId, event.actorId ?? null, event.kind]);
  const key = event.dedupeKey ?? randomUUID();
  for (const recipient of recipients.rows) {
    await client.query(`INSERT INTO notifications (user_id, project_id, task_id, kind, title, body, dedupe_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [recipient.user_id, event.projectId, event.taskId ?? null, event.kind, event.title, event.body, key]);
  }
}
export async function generateDeadlineReminders(userId?: string, projectId?: string) {
  return withTransaction(async (client) => {
    const result = await client.query(`INSERT INTO notifications (user_id, project_id, task_id, kind, title, body, dedupe_key)
      SELECT m.user_id, t.project_id, t.id, 'due',
        CASE WHEN t.due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'Prazo vencido' ELSE 'Entrega se aproxima' END,
        t.title || ' - prazo: ' || to_char(t.due_date, 'DD/MM/YYYY'),
        'due:' || t.id || ':' || to_char(t.due_date, 'YYYY-MM-DD')
      FROM tasks t JOIN project_members m ON m.project_id = t.project_id
      LEFT JOIN notification_preferences p ON p.user_id = m.user_id
      WHERE t.status <> 'done' AND t.due_date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1
        AND coalesce(p.due_reminders, true)
        AND ($1::uuid IS NULL OR m.user_id = $1) AND ($2::uuid IS NULL OR t.project_id = $2)
        AND (m.role = 'leader' OR EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = m.user_id)
          OR NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id))
      ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id`, [userId ?? null, projectId ?? null]);
    return result.rowCount ?? 0;
  });
}
const accessible = `n.user_id = $1 AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = n.project_id AND m.user_id = $1)`;
export async function listNotifications(userId: string) {
  const [items, count] = await Promise.all([
    query(`SELECT n.id, n.project_id AS "projectId", n.task_id AS "taskId", n.kind, n.title, n.body,
      n.created_at AS "createdAt", n.read_at AS "readAt", p.name AS "projectName", p.is_demo AS "isDemo"
      FROM notifications n JOIN projects p ON p.id = n.project_id WHERE ${accessible}
      ORDER BY n.created_at DESC, n.id DESC LIMIT 100`, [userId]),
    query<{ total: number }>(`SELECT count(*)::int AS total FROM notifications n WHERE ${accessible} AND n.read_at IS NULL`, [userId])
  ]);
  return { notifications: items.rows, unreadCount: count.rows[0].total };
}
export async function markNotificationsRead(userId: string, id?: string) {
  return query(`UPDATE notifications n SET read_at = coalesce(read_at, now()) WHERE ${accessible}
    AND ($2::uuid IS NULL OR n.id = $2) RETURNING id`, [userId, id ?? null]);
}
export async function getPreferences(userId: string) {
  await query('INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  return (await query(`SELECT project_updates AS "projectUpdates", task_changes AS "taskChanges", due_reminders AS "dueReminders", email_enabled AS "emailEnabled"
    FROM notification_preferences WHERE user_id = $1`, [userId])).rows[0];
}
