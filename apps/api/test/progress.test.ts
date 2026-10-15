import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrateDatabase } from '../src/db/migrations.js';

test('project progress snapshots and private history', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test'); assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  await migrateDatabase(); const app = await buildApp(); const users: string[] = [];
  async function account() {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Progress fixture', email: `${randomUUID()}@example.com`, password: 'Example123!' } });
    assert.equal(response.statusCode, 201, response.body); const user = response.json().user; users.push(user.id);
    return { ...user, headers: { cookie: `session=${response.cookies.find((item) => item.name === 'session')!.value}` } };
  }
  try {
    const owner = await account(); const stranger = await account();
    const project = (await app.inject({ url: '/api/projects', headers: owner.headers })).json().projects[0];
    const path = `/api/projects/${project.id}`;
    async function progress(days = '30') { const response = await app.inject({ url: `${path}/progress?days=${days}`, headers: owner.headers }); assert.equal(response.statusCode, 200, response.body); return response.json(); }
    const today = (await pool.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS today")).rows[0].today;
    let taskId = '';
    await t.test('requires membership and initializes an honest zero-task baseline', async () => {
      assert.equal((await app.inject({ url: `${path}/progress` })).statusCode, 401);
      assert.equal((await app.inject({ url: `${path}/progress`, headers: stranger.headers })).statusCode, 404);
      const data = await progress(); assert.equal(data.startedAt, today); assert.deepEqual(data.points, [{ date: today, total: 0, completed: 0 }]);
    });
    await t.test('updates daily totals on create, completion, reopening and deletion', async () => {
      taskId = (await app.inject({ method: 'POST', url: `${path}/tasks`, headers: owner.headers, payload: { title: 'Progress task' } })).json().task.id;
      assert.deepEqual((await progress()).points.at(-1), { date: today, total: 1, completed: 0 });
      await app.inject({ method: 'POST', url: `${path}/tasks/${taskId}/move`, headers: owner.headers, payload: { status: 'done' } });
      assert.equal((await progress()).points.at(-1).completed, 1);
      await app.inject({ method: 'PATCH', url: `${path}/tasks/${taskId}`, headers: owner.headers, payload: { status: 'in_review' } });
      assert.equal((await progress()).points.at(-1).completed, 0);
      await app.inject({ method: 'DELETE', url: `${path}/tasks/${taskId}`, headers: owner.headers });
      assert.deepEqual((await progress()).points.at(-1), { date: today, total: 0, completed: 0 });
      assert.equal((await pool.query('SELECT * FROM project_progress_daily WHERE project_id = $1', [project.id])).rowCount, 1);
    });
    await t.test('carries known snapshots through days without activity and bounds date filters', async () => {
      await pool.query(`INSERT INTO project_progress_daily (project_id, day, total, completed) VALUES
        ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 100, 1, 0),
        ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 4, 2, 0),
        ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 2, 3, 1)`, [project.id]);
      const data = await progress('7'); assert.equal(data.points.length, 7);
      assert.deepEqual(data.points.slice(-5).map((point: { total: number; completed: number }) => [point.total, point.completed]), [[2, 0], [2, 0], [3, 1], [3, 1], [0, 0]]);
      assert.equal((await progress('30')).points.length, 30); assert.equal((await progress('90')).points.length, 90);
      assert.equal((await app.inject({ url: `${path}/progress?days=9999`, headers: owner.headers })).statusCode, 400);
      assert.equal((await app.inject({ url: `${path}/progress?days=-1`, headers: owner.headers })).statusCode, 400);
    });
    await t.test('serializes simultaneous task changes without losing snapshot totals', async () => {
      const ids = [];
      for (let index = 0; index < 2; index++) ids.push((await app.inject({ method: 'POST', url: `${path}/tasks`, headers: owner.headers, payload: { title: `Concurrent progress ${index}` } })).json().task.id);
      const results = await Promise.all(ids.map((id) => app.inject({ method: 'POST', url: `${path}/tasks/${id}/move`, headers: owner.headers, payload: { status: 'done' } })));
      results.forEach((response) => assert.equal(response.statusCode, 200, response.body));
      assert.deepEqual((await progress()).points.at(-1), { date: today, total: 2, completed: 2 });
    });
    await t.test('preserves historical data on repeated migration and cascades project deletion', async () => {
      const before = (await progress('90')).points; await migrateDatabase(); assert.deepEqual((await progress('90')).points, before);
      assert.equal((await app.inject({ method: 'DELETE', url: path, headers: owner.headers })).statusCode, 204);
      assert.equal((await pool.query('SELECT * FROM project_progress_daily WHERE project_id = $1', [project.id])).rowCount, 0);
    });
  } finally {
    await pool.query('DELETE FROM projects WHERE created_by = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]); await app.close(); await pool.end();
  }
});
