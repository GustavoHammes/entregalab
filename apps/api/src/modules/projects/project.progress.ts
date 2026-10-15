import { query } from '../../db/pool.js';

export async function projectProgress(projectId: string, days: number) {
  const result = await query<{ date: string; total: number; completed: number }>(`WITH bounds AS (
    SELECT greatest(min(day), (now() AT TIME ZONE 'America/Sao_Paulo')::date - ($2::int - 1)) AS start,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date AS finish FROM project_progress_daily WHERE project_id = $1
  ) SELECT to_char(d.day, 'YYYY-MM-DD') AS date, snapshot.total, snapshot.completed
    FROM bounds b CROSS JOIN LATERAL generate_series(b.start::timestamp, b.finish::timestamp, interval '1 day') d(day)
    CROSS JOIN LATERAL (SELECT total, completed FROM project_progress_daily
      WHERE project_id = $1 AND day <= d.day::date ORDER BY day DESC LIMIT 1) snapshot ORDER BY d.day`, [projectId, days]);
  const startedAt = (await query<{ date: string }>("SELECT to_char(min(day), 'YYYY-MM-DD') AS date FROM project_progress_daily WHERE project_id = $1", [projectId])).rows[0]?.date ?? null;
  return { points: result.rows, startedAt };
}
