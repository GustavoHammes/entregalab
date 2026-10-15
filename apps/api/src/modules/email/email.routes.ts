import { randomBytes } from 'node:crypto';
import { CodeChallengeMethod } from 'google-auth-library';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { query } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { digest, seal, unseal } from './email.crypto.js';
import { emailSettings, requestEmailVerification, verifyEmail } from './email.repository.js';
import { appUrl, gmailClient, gmailConfigured, gmailScope } from './gmail.js';

export async function emailRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const limited = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };
  async function requireAdmin(request: FastifyRequest) {
    if (!(await emailSettings(request.user.sub)).isAdmin) throw new AppError(403, 'EMAIL_ADMIN_REQUIRED', 'Somente o administrador pode configurar o remetente.');
  }
  app.get('/settings', async (request) => emailSettings(request.user.sub));
  app.post('/verification', limited, async (request, reply) => reply.code(202).send(await requestEmailVerification(request.user.sub)));
  app.post('/verify', limited, async (request) => {
    const { token } = z.object({ token: z.string().min(40).max(180) }).strict().parse(request.body);
    await verifyEmail(request.user.sub, token); return { success: true };
  });
  app.post('/gmail/connect', limited, async (request, reply) => {
    await requireAdmin(request);
    if (!gmailConfigured()) throw new AppError(503, 'GMAIL_NOT_CONFIGURED', 'Configure as credenciais OAuth e a chave de criptografia no Render.');
    const state = randomBytes(32).toString('base64url');
    const client = gmailClient(); const pkce = await client.generateCodeVerifierAsync();
    await query('DELETE FROM gmail_oauth_flows WHERE user_id = $1 OR expires_at < now()', [request.user.sub]);
    await query('INSERT INTO gmail_oauth_flows (state_hash, user_id, verifier_encrypted) VALUES ($1, $2, $3)',
      [digest(state), request.user.sub, seal(pkce.codeVerifier)]);
    reply.setCookie('gmail_oauth_state', state, { httpOnly: true, secure: env.SECURE_COOKIES, sameSite: 'lax', path: '/api/email/gmail', maxAge: 600 });
    return { url: client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [gmailScope, 'openid', 'email'],
      state, code_challenge: pkce.codeChallenge, code_challenge_method: CodeChallengeMethod.S256, ...(env.GMAIL_USER ? { login_hint: env.GMAIL_USER } : {}) }) };
  });
  app.get('/gmail/callback', limited, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer');
    reply.clearCookie('gmail_oauth_state', { path: '/api/email/gmail' });
    try {
      await requireAdmin(request);
      const params = z.object({ state: z.string().min(40).max(60), code: z.string().max(4096).optional(), error: z.string().max(200).optional() }).parse(request.query);
      if (!gmailConfigured() || request.cookies.gmail_oauth_state !== params.state) throw new Error('Invalid OAuth state');
      const flow = (await query(`DELETE FROM gmail_oauth_flows WHERE state_hash = $1 AND user_id = $2
        AND expires_at > now() RETURNING verifier_encrypted`, [digest(params.state), request.user.sub])).rows[0];
      if (!flow || params.error || !params.code) throw new Error('OAuth not completed');
      const client = gmailClient();
      const { tokens } = await client.getToken({ code: params.code, codeVerifier: unseal(flow.verifier_encrypted) });
      if (!tokens.refresh_token || !tokens.scope?.split(' ').includes(gmailScope)) throw new Error('Missing Gmail consent');
      client.setCredentials(tokens);
      const profile = await client.request({ url: 'https://openidconnect.googleapis.com/v1/userinfo', timeout: 15000, retry: false });
      const identity = z.object({ email: z.string().email(), email_verified: z.literal(true) }).parse(profile.data);
      if (env.GMAIL_USER && identity.email.toLowerCase() !== env.GMAIL_USER.toLowerCase()) throw new Error('Wrong sender account');
      await query(`INSERT INTO gmail_connection (id, sender, refresh_token_encrypted, connected_by) VALUES (1, $1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET sender = excluded.sender, refresh_token_encrypted = excluded.refresh_token_encrypted,
          connected_by = excluded.connected_by, updated_at = now(), last_error = NULL`, [identity.email, seal(tokens.refresh_token), request.user.sub]);
      return reply.code(303).redirect(`${appUrl()}/#notifications?gmail=connected`);
    } catch {
      request.log.warn('Gmail authorization was not completed');
      return reply.code(303).redirect(`${appUrl()}/#notifications?gmail=failed`);
    }
  });
  app.delete('/gmail/connection', limited, async (request, reply) => {
    await requireAdmin(request);
    const row = (await query('DELETE FROM gmail_connection WHERE id = 1 RETURNING refresh_token_encrypted')).rows[0];
    if (row && gmailConfigured()) {
      try { await gmailClient().revokeToken(unseal(row.refresh_token_encrypted)); }
      catch { request.log.warn('Gmail access was disconnected locally; revoke remaining access in the Google account'); }
    }
    return reply.code(204).send();
  });
  app.post('/gmail/retry', limited, async (request) => {
    await requireAdmin(request);
    if (!(await emailSettings(request.user.sub)).available) throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Conecte o Gmail antes de tentar novamente.');
    const result = await query("UPDATE email_outbox SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL WHERE status = 'failed'");
    return { queued: result.rowCount ?? 0 };
  });
}
