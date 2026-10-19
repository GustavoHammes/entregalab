import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import type { InjectOptions } from 'fastify';
import type { PoolClient } from 'pg';
import { buildApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { pool } from '../src/db/pool.js';

test('project authorization matrix, ID tampering and concurrent revocation', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  await migrateDatabase();
  const app = await buildApp();
  const users: string[] = [];
  async function account(name: string) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      name, email: `${randomUUID()}@example.com`, password: 'Example123!'
    } });
    assert.equal(response.statusCode, 201, response.body);
    const user = response.json().user as { id: string; name: string; email: string };
    users.push(user.id);
    return { ...user, headers: { cookie: `session=${response.cookies.find((cookie) => cookie.name === 'session')!.value}` } };
  }
  // Wait for an observed PostgreSQL lock, not an assumed order or a fixed sleep.
  async function behindProjectLock(projectId: string, request: InjectOptions, change: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
      const pending = app.inject(request).then((response) => response);
      try {
        const until = Date.now() + 10000;
        let waiting = false;
        while (Date.now() < until) {
          waiting = !!(await pool.query(`SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND $1::int = ANY(pg_blocking_pids(pid))`, [pid])).rowCount;
          if (waiting) break;
          await setTimeout(20);
        }
        assert.ok(waiting, `Expected ${request.method} ${request.url} to wait for the project lock`);
        await change(client);
        await client.query('COMMIT');
      } finally {
        await client.query('ROLLBACK');
        await pending;
      }
      return await pending;
    } finally { client.release(); }
  }
  try {
    const owner = await account('Authorization owner');
    const member = await account('Authorization member');
    const outsider = await account('Authorization outsider');
    const ownProjects = async (headers: { cookie: string }) => (await app.inject({ url: '/api/projects', headers })).json().projects;
    const projectId: string = (await ownProjects(owner.headers))[0].id;
    const otherProjectId: string = (await ownProjects(member.headers))[0].id;
    const base = `/api/projects/${projectId}`;
    const otherBase = `/api/projects/${otherProjectId}`;
    async function addMember(path = base) {
      const response = await app.inject({ method: 'POST', url: `${path}/members`, headers: owner.headers, payload: { email: member.email } });
      assert.equal(response.statusCode, 201, response.body);
    }
    await addMember();
    const createTask = async (path: string, headers: { cookie: string }, title: string) => {
      const response = await app.inject({ method: 'POST', url: `${path}/tasks`, headers, payload: { title } });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().task as { id: string };
    };
    const task = await createTask(base, owner.headers, 'Private task in project A');
    const foreignTask = await createTask(otherBase, member.headers, 'Private task in project B');
    const projectRequests: InjectOptions[] = [
      { method: 'GET', url: `${base}/tasks` },
      { method: 'GET', url: `${base}/members` },
      { method: 'GET', url: `${base}/progress?days=30` },
      { method: 'PATCH', url: base, payload: { name: 'Unauthorized project' } },
      { method: 'DELETE', url: base },
      { method: 'POST', url: `${base}/members`, payload: { email: outsider.email } },
      { method: 'DELETE', url: `${base}/members/${member.id}` },
      { method: 'POST', url: `${base}/tasks`, payload: { title: 'Unauthorized task' } },
      { method: 'PATCH', url: `${base}/tasks/${task.id}`, payload: { title: 'Unauthorized edit' } },
      { method: 'DELETE', url: `${base}/tasks/${task.id}` },
      { method: 'POST', url: `${base}/tasks/${task.id}/move`, payload: { status: 'done' } },
      { method: 'GET', url: `${base}/tasks/${task.id}/comments` },
      { method: 'POST', url: `${base}/tasks/${task.id}/comments`, payload: { body: 'Unauthorized comment' } }
    ];
    async function state() {
      return (await pool.query(`SELECT
        (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM tasks t WHERE t.project_id = $1) AS tasks,
        (SELECT count(*)::int FROM comments c JOIN tasks t ON t.id = c.task_id WHERE t.project_id = $1) AS comments,
        (SELECT count(*)::int FROM notifications WHERE project_id = $1) AS notifications,
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY day) FROM project_progress_daily p WHERE project_id = $1) AS progress`, [projectId])).rows[0];
    }
    const tasks = async () => (await app.inject({ url: `${base}/tasks`, headers: owner.headers })).json().tasks as { id: string; status: string; position: number }[];
    async function assertConsistentBoard() {
      const rows = await tasks();
      assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
      for (const status of ['todo', 'in_progress', 'in_review', 'done']) {
        const positions = rows.filter((row) => row.status === status).map((row) => row.position);
        assert.equal(new Set(positions).size, positions.length);
        assert.ok(positions.every((position) => position >= 0));
      }
      const progress = (await app.inject({ url: `${base}/progress`, headers: owner.headers })).json().points.at(-1);
      assert.equal(progress.total, rows.length);
      assert.equal(progress.completed, rows.filter((row) => row.status === 'done').length);
    }

    await t.test('rejects anonymous and outsider requests on every project route without side effects', async () => {
      const before = await state();
      for (const request of projectRequests) {
        const anonymous = await app.inject(request);
        assert.equal(anonymous.statusCode, 401, `${request.method} ${request.url}: ${anonymous.body}`);
        const denied = await app.inject({ ...request, headers: outsider.headers });
        assert.equal(denied.statusCode, 404, `${request.method} ${request.url}: ${denied.body}`);
        assert.equal(denied.json().error.code, 'PROJECT_NOT_FOUND');
        assert.ok(!denied.body.includes('Private task'));
      }
      assert.ok(!(await ownProjects(outsider.headers)).some((project: { id: string }) => project.id === projectId));
      const spoofed = await app.inject({ url: `${base}/tasks`, headers: { 'x-user-id': owner.id, 'x-role': 'leader' } });
      assert.equal(spoofed.statusCode, 401);
      assert.deepEqual(await state(), before);
    });
    await t.test('scopes leader privileges to each project while allowing member collaboration', async () => {
      assert.equal((await ownProjects(member.headers)).find((project: { id: string }) => project.id === projectId).role, 'member');
      assert.equal((await ownProjects(member.headers)).find((project: { id: string }) => project.id === otherProjectId).role, 'leader');
      for (const request of projectRequests.slice(3, 7)) {
        const denied = await app.inject({ ...request, headers: member.headers });
        assert.equal(denied.statusCode, 403, denied.body);
        assert.equal(denied.json().error.code, 'LEADER_REQUIRED');
      }
      for (const request of projectRequests.slice(0, 3)) assert.equal((await app.inject({ ...request, headers: member.headers })).statusCode, 200);
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/tasks/${task.id}`, headers: member.headers, payload: { description: 'Member collaboration' } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks/${task.id}/comments`, headers: member.headers, payload: { body: 'Authorized comment' } })).statusCode, 201);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/tasks/${task.id}/move`, headers: member.headers, payload: { status: 'in_review' } })).statusCode, 200);
    });
    await t.test('blocks cross-project task IDs, comments and ordering anchors with no partial changes', async () => {
      const before = await state();
      for (const request of [
        { method: 'PATCH', url: `${otherBase}/tasks/${task.id}`, payload: { title: 'ID tampering' } },
        { method: 'DELETE', url: `${otherBase}/tasks/${task.id}` },
        { method: 'POST', url: `${otherBase}/tasks/${task.id}/move`, payload: { status: 'done' } },
        { method: 'GET', url: `${otherBase}/tasks/${task.id}/comments` },
        { method: 'POST', url: `${otherBase}/tasks/${task.id}/comments`, payload: { body: 'Cross-project comment' } }
      ] satisfies InjectOptions[]) {
        const response = await app.inject({ ...request, headers: member.headers });
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(response.json().error.code, 'TASK_NOT_FOUND');
      }
      const anchor = await app.inject({ method: 'POST', url: `${base}/tasks/${task.id}/move`, headers: owner.headers, payload: { status: 'todo', beforeId: foreignTask.id } });
      assert.equal(anchor.statusCode, 400); assert.equal(anchor.json().error.code, 'INVALID_POSITION');
      assert.deepEqual(await state(), before);
    });
    await t.test('rejects privilege escalation and project reassignment through request bodies', async () => {
      for (const request of [
        { method: 'POST', url: `${base}/members`, payload: { email: outsider.email, role: 'leader' } },
        { method: 'PATCH', url: base, payload: { name: 'Privilege escalation', role: 'leader', createdBy: outsider.id } },
        { method: 'POST', url: `${base}/tasks`, payload: { title: 'Foreign project injection', projectId: otherProjectId } },
        { method: 'PATCH', url: `${base}/tasks/${task.id}`, payload: { projectId: otherProjectId } }
      ] satisfies InjectOptions[]) assert.equal((await app.inject({ ...request, headers: owner.headers })).statusCode, 400);
      const roles = (await app.inject({ url: `${base}/members`, headers: owner.headers })).json().members;
      assert.equal(roles.length, 2);
      assert.equal(roles.find((user: { id: string }) => user.id === member.id).role, 'member');
    });
    await t.test('revokes every project route and assignments for a removed member with an otherwise valid session', async () => {
      await app.inject({ method: 'PATCH', url: `${base}/tasks/${task.id}`, headers: owner.headers, payload: { assigneeId: member.id } });
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/members/${member.id}`, headers: owner.headers })).statusCode, 204);
      try {
        assert.equal((await app.inject({ url: '/api/auth/me', headers: member.headers })).statusCode, 200);
        for (const request of projectRequests) assert.equal((await app.inject({ ...request, headers: member.headers })).statusCode, 404);
        assert.equal((await pool.query('SELECT 1 FROM task_assignees WHERE task_id = $1 AND user_id = $2', [task.id, member.id])).rowCount, 0);
      } finally { await addMember(); }
    });
    await t.test('serializes moves by different users and keeps board positions and progress consistent', async () => {
      const ids = [];
      for (let index = 0; index < 6; index++) ids.push((await createTask(base, owner.headers, `Parallel task ${index}`)).id);
      const results = await Promise.all(ids.map((id, index) => app.inject({ method: 'POST', url: `${base}/tasks/${id}/move`,
        headers: index % 2 ? member.headers : owner.headers, payload: { status: index % 2 ? 'in_review' : 'done' } })));
      results.forEach((response) => assert.equal(response.statusCode, 200, response.body));
      const rows = await tasks();
      for (const [index, id] of ids.entries()) assert.equal(rows.find((row) => row.id === id)?.status, index % 2 ? 'in_review' : 'done');
      assert.equal(rows.length, 7);
      await assertConsistentBoard();
    });
    await t.test('serializes competing status changes on the same task without duplicating cards', async () => {
      const results = await Promise.all([
        app.inject({ method: 'PATCH', url: `${base}/tasks/${task.id}`, headers: owner.headers, payload: { status: 'done' } }),
        app.inject({ method: 'POST', url: `${base}/tasks/${task.id}/move`, headers: member.headers, payload: { status: 'in_progress' } })
      ]);
      results.forEach((response) => assert.equal(response.statusCode, 200, response.body));
      assert.ok(['done', 'in_progress'].includes((await tasks()).find((row) => row.id === task.id)!.status));
      await assertConsistentBoard();
    });
    await t.test('rechecks membership after waiting when a member is concurrently removed', async () => {
      const writes = projectRequests.slice(7).filter((request) => request.method !== 'GET');
      for (const request of writes) {
        const before = await state();
        const response = await behindProjectLock(projectId, { ...request, headers: member.headers }, async (client) => {
          await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, member.id]);
        });
        try {
          assert.equal(response.statusCode, 404, response.body);
          assert.equal(response.json().error.code, 'PROJECT_NOT_FOUND');
          assert.deepEqual(await state(), before);
        } finally { await addMember(); }
      }
    });
    await t.test('rechecks leader role inside queued project and team mutations', async () => {
      for (const operation of ['edit', 'delete', 'addMember', 'removeMember']) {
        const project = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { name: `Role race ${operation}` } })).json().project;
        const path = `/api/projects/${project.id}`;
        await addMember(path);
        const requests: Record<string, InjectOptions> = {
          edit: { method: 'PATCH', url: path, payload: { name: 'Must not edit after demotion' } },
          delete: { method: 'DELETE', url: path },
          addMember: { method: 'POST', url: `${path}/members`, payload: { email: outsider.email } },
          removeMember: { method: 'DELETE', url: `${path}/members/${member.id}` }
        };
        const response = await behindProjectLock(project.id, { ...requests[operation], headers: owner.headers }, async (client) => {
          await client.query("UPDATE project_members SET role = CASE WHEN user_id = $2 THEN 'member'::project_role ELSE 'leader'::project_role END WHERE project_id = $1", [project.id, owner.id]);
        });
        assert.equal(response.statusCode, 403, response.body);
        assert.equal(response.json().error.code, 'LEADER_REQUIRED');
        const persisted = (await pool.query('SELECT name FROM projects WHERE id = $1', [project.id])).rows[0];
        assert.equal(persisted.name, project.name);
        assert.equal((await pool.query('SELECT 1 FROM project_members WHERE project_id = $1', [project.id])).rowCount, 2);
      }
    });
    await t.test('returns 404 instead of phantom success when a project is deleted during a queued write', async () => {
      for (const operation of ['edit', 'delete', 'addMember', 'removeMember']) {
        const project = (await app.inject({ method: 'POST', url: '/api/projects', headers: owner.headers, payload: { name: `Deletion race ${operation}` } })).json().project;
        const path = `/api/projects/${project.id}`;
        await addMember(path);
        const requests: Record<string, InjectOptions> = {
          edit: { method: 'PATCH', url: path, payload: { name: 'Must not restore deleted project' } },
          delete: { method: 'DELETE', url: path },
          addMember: { method: 'POST', url: `${path}/members`, payload: { email: outsider.email } },
          removeMember: { method: 'DELETE', url: `${path}/members/${member.id}` }
        };
        const response = await behindProjectLock(project.id, { ...requests[operation], headers: owner.headers }, async (client) => {
          await client.query('DELETE FROM projects WHERE id = $1', [project.id]);
        });
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(response.json().error.code, 'PROJECT_NOT_FOUND');
        assert.equal((await pool.query('SELECT 1 FROM project_members WHERE project_id = $1', [project.id])).rowCount, 0);
      }
    });
  } finally {
    await pool.query('DELETE FROM projects WHERE created_by = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await app.close();
    await pool.end();
  }
});
