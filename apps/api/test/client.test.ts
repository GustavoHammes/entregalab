import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { api, json } from '../../web/src/api.js';
import { buildApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { pool } from '../src/db/pool.js';

test('web HTTP client creates, deletes and logs out against a real server', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  await migrateDatabase();
  const app = await buildApp();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const transport = globalThis.fetch;
  let cookie = ''; let userId: string | undefined;
  // Provide only the browser's relative URL resolution and cookie transport.
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('Cookie', cookie);
    const response = await transport(new URL(String(input), address), { ...init, headers });
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    return response;
  };
  try {
    const registration = await api<{ user: { id: string } }>('/auth/register', json('POST', {
      name: 'HTTP client test', email: `http-${randomUUID()}@example.com`, password: 'Example123!'
    }));
    userId = registration.user.id;
    const { projects } = await api<{ projects: { id: string }[] }>('/projects');
    const path = `/projects/${projects[0].id}/tasks`;
    const { task } = await api<{ task: { id: string } }>(path, json('POST', { title: 'HTTP workflow task' }));
    assert.equal(await api(`${path}/${task.id}`, { method: 'DELETE' }), undefined);
    assert.equal((await api<{ tasks: unknown[] }>(path)).tasks.length, 0);
    assert.equal(await api('/auth/logout', { method: 'POST' }), undefined);
    assert.equal((await transport(`${address}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
  } finally {
    globalThis.fetch = transport;
    if (userId) {
      await pool.query('DELETE FROM projects WHERE created_by = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app.close(); await pool.end();
  }
});
