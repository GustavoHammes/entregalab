import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { cleanupExpiredDemos } from '../src/modules/demo/demo.repository.js';

test('isolated demo administration and notification preferences', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  await migrateDatabase();
  const app = await buildApp(); const users: string[] = [];
  async function account(demo = false) {
    const response = await app.inject({ method: 'POST', url: demo ? '/api/demo/session' : '/api/auth/register',
      ...(demo ? {} : { payload: { name: 'Notification test', email: `${randomUUID()}@example.com`, password: 'Example123!' } }) });
    assert.equal(response.statusCode, 201, response.body);
    const user = response.json().user; users.push(user.id);
    return { ...user, headers: { cookie: `session=${response.cookies.find((cookie) => cookie.name === 'session')!.value}` } };
  }
  try {
    const first = await account(true); const second = await account(true); const real = await account(); const colleague = await account();
    let examples = (await app.inject({ url: '/api/projects', headers: first.headers })).json().projects;
    const realProject = (await app.inject({ url: '/api/projects', headers: real.headers })).json().projects[0].id;
    let personalTask = ''; let collaborationTask = '';
    await t.test('provides two private demo projects with twelve tasks and leadership', async () => {
      assert.equal(first.isDemo, true); assert.equal(examples.length, 2);
      assert.equal(examples.reduce((sum: number, project: { taskCount: number }) => sum + project.taskCount, 0), 12);
      examples.forEach((project: { role: string; isDemo: boolean }) => { assert.equal(project.role, 'leader'); assert.equal(project.isDemo, true); });
      assert.equal((await app.inject({ url: `/api/projects/${examples[0].id}/tasks`, headers: second.headers })).statusCode, 404);
      const other = (await app.inject({ url: '/api/projects', headers: second.headers })).json().projects;
      assert.ok(other.every((project: { id: string }) => !examples.some((item: { id: string }) => item.id === project.id)));
    });
    await t.test('lets demo administrators manage fictitious members', async () => {
      const path = `/api/projects/${examples[0].id}/members`;
      assert.equal((await app.inject({ method: 'POST', url: path, headers: first.headers, payload: { name: 'Fictitious teammate' } })).statusCode, 201);
      assert.equal((await app.inject({ url: path, headers: first.headers })).json().members.length, 4);
      assert.equal((await app.inject({ method: 'POST', url: path, headers: first.headers, payload: { email: real.email } })).statusCode, 400);
    });
    await t.test('resets only the current account demo projects and preserves real tasks', async () => {
      const task = await app.inject({ method: 'POST', url: `/api/projects/${realProject}/tasks`, headers: real.headers, payload: { title: 'Keep this real task' } });
      personalTask = task.json().task.id;
      assert.equal((await app.inject({ method: 'POST', url: '/api/demo/projects', headers: real.headers })).statusCode, 200);
      const old = (await app.inject({ url: '/api/projects', headers: real.headers })).json().projects.filter((project: { isDemo: boolean }) => project.isDemo);
      assert.equal((await app.inject({ method: 'POST', url: '/api/demo/reset', headers: real.headers })).statusCode, 200);
      assert.equal((await app.inject({ url: `/api/projects/${old[0].id}/tasks`, headers: real.headers })).statusCode, 404);
      const stored = (await app.inject({ url: `/api/projects/${realProject}/tasks`, headers: real.headers })).json().tasks;
      assert.equal(stored[0].id, personalTask);
      assert.equal((await app.inject({ url: `/api/projects/${examples[0].id}/tasks`, headers: first.headers })).statusCode, 200);
    });
    await t.test('provides incoming notifications without exposing another inbox', async () => {
      const inbox = (await app.inject({ url: '/api/notifications', headers: first.headers })).json();
      assert.ok(inbox.unreadCount > 0);
      const id = inbox.notifications[0].id;
      assert.equal((await app.inject({ method: 'PATCH', url: `/api/notifications/${id}/read`, headers: second.headers })).statusCode, 404);
      assert.equal((await app.inject({ method: 'PATCH', url: `/api/notifications/${id}/read`, headers: first.headers })).statusCode, 200);
      assert.equal((await app.inject({ url: '/api/notifications', headers: first.headers })).json().unreadCount, inbox.unreadCount - 1);
      assert.equal((await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: first.headers })).statusCode, 200);
      assert.equal((await app.inject({ url: '/api/notifications', headers: first.headers })).json().unreadCount, 0);
    });
    await t.test('honors task preferences and notifies other members on movements', async () => {
      await app.inject({ method: 'POST', url: `/api/projects/${realProject}/members`, headers: real.headers, payload: { email: colleague.email } });
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: real.headers, payload: { taskChanges: false } })).statusCode, 200);
      const create = await app.inject({ method: 'POST', url: `/api/projects/${realProject}/tasks`, headers: colleague.headers, payload: { title: 'Preference controlled task' } });
      collaborationTask = create.json().task.id;
      assert.ok(!(await app.inject({ url: '/api/notifications', headers: real.headers })).json().notifications.some((item: { taskId: string }) => item.taskId === collaborationTask));
      await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: real.headers, payload: { taskChanges: true } });
      await app.inject({ method: 'POST', url: `/api/projects/${realProject}/tasks/${collaborationTask}/move`, headers: colleague.headers, payload: { status: 'in_review' } });
      const event = (await app.inject({ url: '/api/notifications', headers: real.headers })).json().notifications.find((item: { taskId: string }) => item.taskId === collaborationTask);
      assert.equal(event.title, 'Tarefa movimentada'); assert.match(event.body, /Em revisao/);
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: real.headers, payload: { unknown: true } })).statusCode, 400);
    });
    await t.test('deduplicates deadlines and marks completion reminders read', async () => {
      const today = (await pool.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS today")).rows[0].today;
      await app.inject({ method: 'PATCH', url: `/api/projects/${realProject}/tasks/${personalTask}`, headers: real.headers, payload: { dueDate: today } });
      await app.inject({ method: 'POST', url: '/api/notifications/check-deadlines', headers: real.headers });
      await app.inject({ method: 'POST', url: '/api/notifications/check-deadlines', headers: real.headers });
      const due = (await app.inject({ url: '/api/notifications', headers: real.headers })).json().notifications.filter((item: { taskId: string; kind: string }) => item.taskId === personalTask && item.kind === 'due');
      assert.equal(due.length, 1); assert.equal(due[0].readAt, null);
      await app.inject({ method: 'POST', url: `/api/projects/${realProject}/tasks/${personalTask}/move`, headers: real.headers, payload: { status: 'done' } });
      assert.ok((await app.inject({ url: '/api/notifications', headers: real.headers })).json().notifications.find((item: { id: string }) => item.id === due[0].id).readAt);
    });
    await t.test('revokes access to project notifications when membership is removed', async () => {
      const inbox = (await app.inject({ url: '/api/notifications', headers: colleague.headers })).json();
      assert.ok(inbox.notifications.some((item: { projectId: string }) => item.projectId === realProject));
      await app.inject({ method: 'DELETE', url: `/api/projects/${realProject}/members/${colleague.id}`, headers: real.headers });
      assert.ok(!(await app.inject({ url: '/api/notifications', headers: colleague.headers })).json().notifications.some((item: { projectId: string }) => item.projectId === realProject));
    });
    await t.test('expires demo sessions and removes only their data', async () => {
      await pool.query("UPDATE users SET demo_expires_at = now() - interval '1 minute' WHERE id = $1", [first.id]);
      assert.equal((await app.inject({ url: '/api/auth/me', headers: first.headers })).statusCode, 401);
      assert.equal(await cleanupExpiredDemos(), 1);
      assert.equal((await app.inject({ url: '/api/projects', headers: second.headers })).statusCode, 200);
      assert.equal((await app.inject({ url: `/api/projects/${realProject}/tasks`, headers: real.headers })).statusCode, 200);
    });
  } finally {
    await pool.query('DELETE FROM projects WHERE created_by = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await app.close(); await pool.end();
  }
});
