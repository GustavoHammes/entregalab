import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { OAuth2Client } from 'google-auth-library';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { parseEnvironment } from '../src/config/schema.js';
import { pool, withTransaction } from '../src/db/pool.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { digest, seal, unseal, verificationToken } from '../src/modules/email/email.crypto.js';
import { composeMessage, gmailScope, gmailSender, type EmailMessage } from '../src/modules/email/gmail.js';
import { processEmailQueue } from '../src/modules/email/email.worker.js';
import { notifyProject } from '../src/modules/notifications/notification.repository.js';

test('Gmail authorization, verified opt-in and durable email delivery', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  await migrateDatabase();
  env.APP_URL = 'https://email-test.example.com'; env.EMAIL_TOKEN_KEY = 'ab'.repeat(32);
  env.GMAIL_CLIENT_ID = 'example.apps.googleusercontent.com'; env.GMAIL_CLIENT_SECRET = 'test-client-secret';
  env.GMAIL_USER = 'sender@example.com'; env.EMAIL_ENABLED = true;
  const app = await buildApp(); const users: string[] = [];
  const sent: EmailMessage[] = [];
  const send = async (message: EmailMessage) => { sent.push(message); return `provider-${message.id}`; };
  async function account(demo = false) {
    const response = await app.inject({ method: 'POST', url: demo ? '/api/demo/session' : '/api/auth/register',
      ...(demo ? {} : { payload: { name: 'Email fixture', email: `${randomUUID()}@example.com`, password: 'Example123!' } }) });
    assert.equal(response.statusCode, 201, response.body);
    const user = response.json().user; users.push(user.id);
    return { ...user, headers: { cookie: `session=${response.cookies.find((item) => item.name === 'session')!.value}` } };
  }
  try {
    const admin = await account(); const recipient = await account(); const demo = await account(true);
    env.EMAIL_ADMIN_USER_ID = admin.id;
    const projectId = (await app.inject({ url: '/api/projects', headers: admin.headers })).json().projects[0].id;
    await app.inject({ method: 'POST', url: `/api/projects/${projectId}/members`, headers: admin.headers, payload: { email: recipient.email } });
    await pool.query('INSERT INTO gmail_connection (id, sender, refresh_token_encrypted) VALUES (1, $1, $2)', [env.GMAIL_USER, seal('test-refresh-token')]);
    async function event(key = randomUUID(), kind = 'task' as 'task' | 'project') {
      await withTransaction((client) => notifyProject(client, { projectId, actorId: admin.id, kind, title: 'Test notification', body: 'Private fixture content', dedupeKey: key }));
      return (await pool.query('SELECT id FROM email_outbox WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [recipient.id])).rows[0]?.id;
    }
    async function clearQueue() { await pool.query('DELETE FROM email_outbox WHERE user_id = ANY($1::uuid[])', [users]); sent.length = 0; }
    async function connect() {
      const response = await app.inject({ method: 'POST', url: '/api/email/gmail/connect', headers: admin.headers });
      assert.equal(response.statusCode, 200, response.body);
      const state = new URL(response.json().url).searchParams.get('state')!;
      return { state, headers: { cookie: `${admin.headers.cookie}; gmail_oauth_state=${response.cookies.find((item) => item.name === 'gmail_oauth_state')!.value}` }, url: response.json().url };
    }
    await t.test('encrypts OAuth credentials and uses MIME without SMTP', async () => {
      const encrypted = seal('not-a-real-token'); assert.notEqual(encrypted, 'not-a-real-token'); assert.equal(unseal(encrypted), 'not-a-real-token');
      const tampered = Buffer.from(encrypted, 'base64url'); tampered[30] ^= 1; assert.throws(() => unseal(tampered.toString('base64url')));
      const raw = await composeMessage(env.GMAIL_USER!, { id: randomUUID(), to: recipient.email, subject: 'Atribuicao de tarefa', text: 'Teste UTF-8: revisao e prazo.' });
      const mime = Buffer.from(raw, 'base64url').toString(); assert.match(mime, /Content-Type: text\/plain/); assert.match(mime, /Message-ID:/);
      await assert.rejects(composeMessage('attacker\r\nBcc: x@example.com', { id: randomUUID(), to: recipient.email, subject: 'Test', text: 'Test' }));
    });
    await t.test('keeps sender setup private and requires an explicit administrator ID', async () => {
      assert.equal((await app.inject({ url: '/api/email/settings' })).statusCode, 401);
      const settings = (await app.inject({ url: '/api/email/settings', headers: recipient.headers })).json();
      assert.equal(settings.isAdmin, false); assert.equal(settings.gmail, undefined); assert.equal(settings.emailEnabled, false);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/gmail/connect', headers: recipient.headers })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url: '/api/email/gmail/connection', headers: recipient.headers })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/gmail/retry', headers: recipient.headers })).statusCode, 403);
    });
    await t.test('sends composed MIME only through the Gmail HTTPS endpoint', async (sub) => {
      const request = sub.mock.method(OAuth2Client.prototype, 'request', async (options: { url: string; method: string; data: { raw: string }; retry: boolean }) => {
        assert.equal(options.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
        assert.equal(options.method, 'POST'); assert.equal(options.retry, false);
        assert.match(Buffer.from(options.data.raw, 'base64url').toString(), /Subject: Provider contract/);
        return { data: { id: 'gmail-fixture-id' } };
      });
      assert.equal(await gmailSender(env.GMAIL_USER!, 'mock-refresh-token')({ id: randomUUID(), to: recipient.email, subject: 'Provider contract', text: 'Fixture' }), 'gmail-fixture-id');
      assert.equal(request.mock.callCount(), 1);
    });
    await t.test('rejects email opt-in before verification and never sends from demos', async () => {
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: recipient.headers, payload: { emailEnabled: true } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/verification', headers: demo.headers })).statusCode, 403);
      const demoSettings = (await app.inject({ url: '/api/email/settings', headers: demo.headers })).json(); assert.equal(demoSettings.isDemo, true);
      assert.equal((await pool.query('SELECT id FROM email_outbox WHERE user_id = $1', [demo.id])).rowCount, 0);
      await event(); assert.equal((await pool.query('SELECT id FROM email_outbox WHERE user_id = $1', [recipient.id])).rowCount, 0);
    });
    await t.test('queues confirmation with rate limits, single-use tokens and account binding', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/verification', headers: recipient.headers })).statusCode, 202);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/verification', headers: recipient.headers })).statusCode, 429);
      assert.equal(await processEmailQueue(send), 1);
      const token = decodeURIComponent(sent[0].text.match(/verify=([^\s]+)/)![1]);
      assert.equal(sent[0].to, recipient.email);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/verify', headers: admin.headers, payload: { token } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/verify', headers: recipient.headers, payload: { token } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/verify', headers: recipient.headers, payload: { token } })).statusCode, 400);
      const settings = (await app.inject({ url: '/api/email/settings', headers: recipient.headers })).json(); assert.equal(settings.verified, true); assert.equal(settings.emailEnabled, false);
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: recipient.headers, payload: { emailEnabled: true } })).statusCode, 200);
      await clearQueue();
    });
    await t.test('rejects expired confirmations and cancels unsent expired verification emails', async () => {
      const id = randomUUID(); const token = verificationToken(id);
      await pool.query("INSERT INTO email_verifications (id, user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() - interval '1 minute')", [id, admin.id, admin.email, digest(token)]);
      await pool.query('INSERT INTO email_outbox (user_id, verification_id) VALUES ($1, $2)', [admin.id, id]);
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/verify', headers: admin.headers, payload: { token } })).statusCode, 400);
      assert.equal(await processEmailQueue(send), 0); assert.equal(sent.length, 0); await clearQueue();
    });
    await t.test('creates exactly one queue entry per new notification and commits atomically', async () => {
      const key = randomUUID(); await event(key); await event(key);
      assert.equal((await pool.query('SELECT id FROM email_outbox WHERE user_id = $1', [recipient.id])).rowCount, 1);
      await assert.rejects(withTransaction(async (client) => {
        await notifyProject(client, { projectId, actorId: admin.id, kind: 'task', title: 'Rollback fixture', body: 'Not committed' });
        throw new Error('Expected rollback');
      }));
      assert.equal((await pool.query('SELECT id FROM email_outbox WHERE user_id = $1', [recipient.id])).rowCount, 1);
      assert.equal(await processEmailQueue(send), 1); assert.equal(sent[0].to, recipient.email);
      const job = (await pool.query('SELECT status, provider_id FROM email_outbox WHERE user_id = $1', [recipient.id])).rows[0];
      assert.equal(job.status, 'sent'); assert.match(job.provider_id, /^provider-/);
      await clearQueue();
    });
    await t.test('rechecks preferences before sending queued messages', async () => {
      const id = await event(); await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: recipient.headers, payload: { emailEnabled: false } });
      assert.equal(await processEmailQueue(send), 0); assert.equal(sent.length, 0);
      assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id = $1', [id])).rows[0].status, 'cancelled');
      await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: recipient.headers, payload: { emailEnabled: true } });
      await clearQueue();
    });
    await t.test('does not send overdue reminders after task completion', async () => {
      const today = (await pool.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS today")).rows[0].today;
      const task = (await app.inject({ method: 'POST', url: `/api/projects/${projectId}/tasks`, headers: admin.headers, payload: { title: 'Deadline email fixture', dueDate: today } })).json().task;
      await clearQueue(); await app.inject({ method: 'POST', url: '/api/notifications/check-deadlines', headers: recipient.headers });
      const job = (await pool.query('SELECT id FROM email_outbox WHERE user_id = $1', [recipient.id])).rows[0]; assert.ok(job);
      await pool.query("UPDATE tasks SET status = 'done' WHERE id = $1", [task.id]);
      assert.equal(await processEmailQueue(send), 0); assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id = $1', [job.id])).rows[0].status, 'cancelled');
      await clearQueue();
    });
    await t.test('excludes example projects even for opted-in real users', async () => {
      await app.inject({ method: 'POST', url: '/api/demo/projects', headers: recipient.headers });
      await app.inject({ method: 'POST', url: '/api/notifications/check-deadlines', headers: recipient.headers });
      assert.equal((await pool.query('SELECT id FROM email_outbox WHERE user_id = $1', [recipient.id])).rowCount, 0);
    });
    await t.test('retries failures with backoff without storing provider secrets', async () => {
      const id = await event();
      assert.equal(await processEmailQueue(async () => { throw new Error('Secret provider payload that must never be stored'); }, 1), 0);
      const failed = (await pool.query('SELECT * FROM email_outbox WHERE id = $1', [id])).rows[0];
      assert.equal(failed.status, 'pending'); assert.equal(failed.attempts, 1); assert.equal(failed.last_error, 'EMAIL_PROVIDER_ERROR');
      assert.ok(failed.next_attempt_at > new Date());
      await pool.query('UPDATE email_outbox SET next_attempt_at = now() WHERE id = $1', [id]);
      assert.equal(await processEmailQueue(send), 1); await clearQueue();
    });
    await t.test('marks exhausted attempts failed and lets only the administrator retry', async () => {
      const id = await event(); await pool.query('UPDATE email_outbox SET attempts = 4 WHERE id = $1', [id]);
      await processEmailQueue(async () => { throw new Error('Expected fixture failure'); });
      assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id = $1', [id])).rows[0].status, 'failed');
      assert.equal((await app.inject({ method: 'POST', url: '/api/email/gmail/retry', headers: admin.headers })).json().queued, 1);
      assert.equal(await processEmailQueue(send), 1); await clearQueue();
    });
    await t.test('recovers expired leases and does not double-send under concurrent workers', async () => {
      const id = await event(); await pool.query("UPDATE email_outbox SET status = 'processing', attempts = 1, lease_until = now() - interval '1 minute' WHERE id = $1", [id]);
      const results = await Promise.all([processEmailQueue(send), processEmailQueue(send)]);
      assert.equal(results.reduce((sum, value) => sum + value, 0), 1); assert.equal(sent.length, 1); await clearQueue();
    });
    await t.test('enforces a shared daily budget without losing pending messages', async () => {
      env.EMAIL_MAX_PER_DAY = 1; await pool.query('DELETE FROM email_daily_usage');
      await event(); await event();
      assert.equal(await processEmailQueue(send), 1);
      assert.equal((await pool.query("SELECT id FROM email_outbox WHERE user_id = $1 AND status = 'pending'", [recipient.id])).rowCount, 1);
      assert.equal(await processEmailQueue(send), 0);
      env.EMAIL_MAX_PER_DAY = 100; await pool.query('DELETE FROM email_daily_usage'); await clearQueue();
    });
    await t.test('pauses delivery when disabled or when Google requires reauthorization', async () => {
      await event(); env.EMAIL_ENABLED = false; assert.equal(await processEmailQueue(send), 0); env.EMAIL_ENABLED = true;
      await processEmailQueue(async () => { throw { response: { status: 400, data: { error: 'invalid_grant' } } }; });
      assert.equal((await pool.query('SELECT last_error FROM gmail_connection WHERE id = 1')).rows[0].last_error, 'GMAIL_REAUTH_REQUIRED');
      assert.equal((await app.inject({ url: '/api/email/settings', headers: recipient.headers })).json().available, false);
      assert.equal(await processEmailQueue(send), 0); await pool.query('UPDATE gmail_connection SET last_error = NULL WHERE id = 1'); await clearQueue();
    });
    await t.test('uses restricted Google scopes, PKCE and browser-bound single-use state', async () => {
      const flow = await connect(); const url = new URL(flow.url);
      assert.equal(url.hostname, 'accounts.google.com'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('scope'), `${gmailScope} openid email`); assert.equal(url.searchParams.get('access_type'), 'offline');
      assert.equal(url.searchParams.get('redirect_uri'), `${env.APP_URL}/api/email/gmail/callback`);
      const missingCookie = await app.inject({ url: `/api/email/gmail/callback?state=${flow.state}&error=access_denied`, headers: admin.headers });
      assert.equal(missingCookie.statusCode, 303); assert.match(missingCookie.headers.location!, /gmail=failed$/);
      const denied = await app.inject({ url: `/api/email/gmail/callback?state=${flow.state}&error=access_denied`, headers: flow.headers });
      assert.equal(denied.statusCode, 303); assert.equal((await pool.query('SELECT * FROM gmail_oauth_flows WHERE user_id = $1', [admin.id])).rowCount, 0);
    });
    await t.test('rejects the wrong Gmail account and stores successful OAuth tokens encrypted', async (sub) => {
      sub.mock.method(OAuth2Client.prototype, 'getToken', async () => ({ tokens: { refresh_token: 'new-test-refresh-token', access_token: 'not-real', scope: gmailScope }, res: null }));
      const profile = sub.mock.method(OAuth2Client.prototype, 'request', async () => ({ data: { email: 'wrong@example.com', email_verified: true } }));
      let flow = await connect();
      assert.match((await app.inject({ url: `/api/email/gmail/callback?state=${flow.state}&code=test-code`, headers: flow.headers })).headers.location!, /gmail=failed$/);
      profile.mock.mockImplementation(async () => ({ data: { email: env.GMAIL_USER, email_verified: true } }));
      flow = await connect();
      const result = await app.inject({ url: `/api/email/gmail/callback?state=${flow.state}&code=test-code`, headers: flow.headers });
      assert.match(result.headers.location!, /gmail=connected$/);
      const stored = (await pool.query('SELECT refresh_token_encrypted FROM gmail_connection WHERE id = 1')).rows[0];
      assert.notEqual(stored.refresh_token_encrypted, 'new-test-refresh-token'); assert.equal(unseal(stored.refresh_token_encrypted), 'new-test-refresh-token');
      assert.match((await app.inject({ url: `/api/email/gmail/callback?state=${flow.state}&code=test-code`, headers: flow.headers })).headers.location!, /gmail=failed$/);
    });
    await t.test('revokes queued project emails when membership is removed', async () => {
      const id = await event();
      await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/members/${recipient.id}`, headers: admin.headers });
      assert.equal(await processEmailQueue(send), 0); assert.equal(sent.length, 0);
      assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id = $1', [id])).rows[0].status, 'cancelled');
    });
    await t.test('keeps projects and tasks usable with invalid optional email settings', async () => {
      const previous = { ...env };
      try {
        for (const key of Object.keys(env)) Reflect.deleteProperty(env, key);
        Object.assign(env, parseEnvironment({ ...process.env, EMAIL_ENABLED: 'true', EMAIL_ADMIN_USER_ID: 'user.id', EMAIL_TOKEN_KEY: 'invalid-key' }).env);
        assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
        assert.equal((await app.inject({ url: '/api/projects', headers: admin.headers })).statusCode, 200);
        const created = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/tasks`, headers: admin.headers, payload: { title: 'Email configuration regression' } });
        assert.equal(created.statusCode, 201, created.body);
        const taskId = created.json().task.id;
        assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/tasks/${taskId}`, headers: admin.headers })).statusCode, 204);
        const settings = (await app.inject({ url: '/api/email/settings', headers: admin.headers })).json();
        assert.equal(settings.available, false); assert.equal(settings.enabled, false); assert.equal(settings.isAdmin, false);
        assert.equal((await app.inject({ method: 'POST', url: '/api/email/gmail/connect', headers: admin.headers })).statusCode, 403);
        assert.equal((await app.inject({ method: 'POST', url: '/api/email/verification', headers: admin.headers })).statusCode, 503);
        assert.equal(await processEmailQueue(async () => { assert.fail('Invalid email configuration must never send'); }), 0);
      } finally { Object.assign(env, previous); }
    });
  } finally {
    await pool.query('DELETE FROM gmail_connection WHERE id = 1'); await pool.query('DELETE FROM email_daily_usage');
    await pool.query('DELETE FROM projects WHERE created_by = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]); await app.close(); await pool.end();
  }
});
