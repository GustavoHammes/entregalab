import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { pool } from '../src/db/pool.js';

test('authenticated project workflow with PostgreSQL', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  await migrateDatabase();
  await migrateDatabase();
  const app = await buildApp();
  const users: string[] = [];
  const suffix = randomUUID();
  async function register(name: string) {
    const email = `${name}-${suffix}@example.com`;
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name, email, password: 'Example123!' } });
    assert.equal(response.statusCode, 201, response.body);
    const user = response.json().user;
    users.push(user.id);
    assert.equal(response.json().token, undefined);
    assert.match(String(response.headers['set-cookie']), /HttpOnly/);
    assert.match(String(response.headers['set-cookie']), /SameSite=Lax/);
    const session = response.cookies.find((cookie) => cookie.name === 'session')!.value;
    return { ...user, cookie: `session=${session}` };
  }
  try {
    const leader = await register('Leader'); const member = await register('Member'); const outsider = await register('Outsider');
    const headers = { cookie: leader.cookie };
    const memberHeaders = { cookie: member.cookie }; const otherHeaders = { cookie: outsider.cookie };
    const projects = await app.inject({ url: '/api/projects', headers });
    assert.equal(projects.statusCode, 200);
    const projectId = projects.json().projects[0].id;
    const base = `/api/projects/${projectId}`;
    let taskId = ''; let secondId = '';

    await t.test('requires a valid session and rejects an invalid login', async () => {
      assert.equal((await app.inject({ url: `${base}/tasks` })).statusCode, 401);
      assert.equal((await app.inject({ url: `${base}/tasks`, headers: { cookie: 'session=invalid' } })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: leader.email, password: 'wrong' } })).statusCode, 401);
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: leader.email, password: 'Example123!' } });
      assert.equal(login.statusCode, 200);
      assert.equal((await app.inject({ url: '/api/auth/me', headers })).json().user.id, leader.id);
    });
    await t.test('validates passwords, task fields and calendar dates', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Bad', email: `bad-${suffix}@example.com`, password: 'short' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks`, headers, payload: { title: 'x' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks`, headers, payload: { title: 'Invalid date', dueDate: '2026-02-30' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks`, headers, payload: { title: 'Invalid priority', priority: 'urgent' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Invalid sprint', sprintStart: '2026-12-01', sprintEnd: '2026-11-01' } })).statusCode, 400);
    });
    await t.test('isolates private projects from other accounts', async () => {
      assert.equal((await app.inject({ url: `${base}/tasks`, headers: otherHeaders })).statusCode, 404);
      assert.equal((await app.inject({ url: `${base}/members`, headers: otherHeaders })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks`, headers: otherHeaders, payload: { title: 'Unauthorized task' } })).statusCode, 404);
    });
    await t.test('blocks requests from an unrelated browser origin', async () => {
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks`, headers: { ...headers, origin: 'https://unrelated.example' }, payload: { title: 'CSRF task' } })).statusCode, 403);
    });
    await t.test('allows the leader to add registered members', async () => {
      const response = await app.inject({ method: 'POST', url: `${base}/members`, headers, payload: { email: member.email } });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal((await app.inject({ url: `${base}/members`, headers: memberHeaders })).json().members.length, 2);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/members`, headers, payload: { email: member.email } })).statusCode, 409);
    });
    await t.test('restricts project and team management to the leader', async () => {
      assert.equal((await app.inject({ method: 'PATCH', url: base, headers: memberHeaders, payload: { name: 'Blocked edit' } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url: base, headers: memberHeaders })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/members`, headers: memberHeaders, payload: { email: outsider.email } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/members/${leader.id}`, headers })).statusCode, 400);
    });
    await t.test('creates persistent tasks and permits member collaboration', async () => {
      const response = await app.inject({ method: 'POST', url: `${base}/tasks`, headers, payload: { title: 'Prepare presentation', priority: 'high', dueDate: '2026-10-30', assigneeId: member.id } });
      assert.equal(response.statusCode, 201, response.body); taskId = response.json().task.id;
      assert.equal(response.json().task.dueDate, '2026-10-30');
      const edit = await app.inject({ method: 'PATCH', url: `${base}/tasks/${taskId}`, headers: memberHeaders, payload: { title: 'Prepare final presentation', description: 'Review acceptance criteria' } });
      assert.equal(edit.statusCode, 200, edit.body);
      const stored = (await app.inject({ url: `${base}/tasks`, headers })).json().tasks;
      assert.equal(stored[0].title, 'Prepare final presentation');
    });
    await t.test('rejects assignees outside the project without partial changes', async () => {
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks`, headers, payload: { title: 'Invalid assignee', assigneeId: outsider.id } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/tasks/${taskId}`, headers, payload: { title: 'Must roll back', assigneeId: outsider.id } })).statusCode, 400);
      const tasks = (await app.inject({ url: `${base}/tasks`, headers })).json().tasks;
      assert.equal(tasks.length, 1); assert.equal(tasks[0].title, 'Prepare final presentation');
    });
    await t.test('moves between all valid states and rejects invalid states', async () => {
      for (const status of ['in_progress', 'in_review', 'done', 'todo']) {
        const response = await app.inject({ method: 'POST', url: `${base}/tasks/${taskId}/move`, headers: memberHeaders, payload: { status } });
        assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().task.status, status);
      }
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks/${taskId}/move`, headers, payload: { status: 'unknown' } })).statusCode, 400);
    });
    await t.test('persists board order and serializes concurrent moves', async () => {
      const second = await app.inject({ method: 'POST', url: `${base}/tasks`, headers, payload: { title: 'Second task' } });
      secondId = second.json().task.id;
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks/${secondId}/move`, headers, payload: { status: 'todo', beforeId: taskId } })).statusCode, 200);
      assert.equal((await app.inject({ url: `${base}/tasks`, headers })).json().tasks[0].id, secondId);
      const responses = await Promise.all([taskId, secondId].map((id) => app.inject({ method: 'POST', url: `${base}/tasks/${id}/move`, headers, payload: { status: 'in_review' } })));
      responses.forEach((response) => assert.equal(response.statusCode, 200, response.body));
      const positions = (await app.inject({ url: `${base}/tasks`, headers })).json().tasks.map((task: { position: number }) => task.position);
      assert.equal(new Set(positions).size, positions.length);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks/${taskId}/move`, headers, payload: { status: 'done', beforeId: secondId } })).statusCode, 400);
    });
    await t.test('protects individual task identifiers across projects', async () => {
      const otherProject = (await app.inject({ url: '/api/projects', headers: otherHeaders })).json().projects[0].id;
      for (const method of ['PATCH', 'DELETE'] as const) {
        assert.equal((await app.inject({ method, url: `/api/projects/${otherProject}/tasks/${taskId}`, headers: otherHeaders, ...(method === 'PATCH' ? { payload: { title: 'Cross project edit' } } : {}) })).statusCode, 404);
      }
    });
    await t.test('persists comments and prevents outsiders from reading them', async () => {
      const response = await app.inject({ method: 'POST', url: `${base}/tasks/${taskId}/comments`, headers: memberHeaders, payload: { body: 'Ready for review.' } });
      assert.equal(response.statusCode, 201, response.body);
      const comments = (await app.inject({ url: `${base}/tasks/${taskId}/comments`, headers })).json().comments;
      assert.equal(comments[0].authorName, member.name);
      assert.equal((await app.inject({ url: `${base}/tasks/${taskId}/comments`, headers: otherHeaders })).statusCode, 404);
    });
    await t.test('revokes project access and assignments when a member is removed', async () => {
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/members/${member.id}`, headers })).statusCode, 204);
      assert.equal((await app.inject({ url: `${base}/tasks`, headers: memberHeaders })).statusCode, 404);
      const tasks = (await app.inject({ url: `${base}/tasks`, headers })).json().tasks;
      assert.equal(tasks.find((task: { id: string }) => task.id === taskId).assigneeId, null);
    });
    await t.test('deletes tasks and cascades comments', async () => {
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/tasks/${taskId}`, headers })).statusCode, 204);
      assert.equal((await app.inject({ url: `${base}/tasks/${taskId}/comments`, headers })).statusCode, 404);
      const count = await pool.query('SELECT count(*)::int AS count FROM comments WHERE task_id = $1', [taskId]);
      assert.equal(count.rows[0].count, 0);
    });
    await t.test('logs out by clearing the session cookie', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
      assert.equal(response.statusCode, 204); assert.match(String(response.headers['set-cookie']), /Expires=Thu, 01 Jan 1970/);
    });
    await t.test('limits repeated authentication attempts', async () => {
      let status = 0;
      for (let i = 0; i < 16; i++) status = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: leader.email, password: 'wrong' } })).statusCode;
      assert.equal(status, 429);
    });
  } finally {
    await pool.query('DELETE FROM projects WHERE created_by = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await app.close(); await pool.end();
  }
});
