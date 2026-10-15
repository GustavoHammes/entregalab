import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { digest, verificationToken } from './email.crypto.js';
import { gmailConfigured } from './gmail.js';

export async function emailSettings(userId: string) {
  const user = (await query(`SELECT u.email, u.is_demo, u.email_verified_at,
    coalesce(p.email_enabled, false) AS email_enabled FROM users u
    LEFT JOIN notification_preferences p ON p.user_id = u.id WHERE u.id = $1`, [userId])).rows[0];
  const connection = (await query('SELECT sender, last_error FROM gmail_connection WHERE id = 1')).rows[0];
  const isAdmin = !user.is_demo && userId === env.EMAIL_ADMIN_USER_ID;
  const delivery = (await query(`SELECT count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
    count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'sent')::int AS sent
    FROM email_outbox WHERE user_id = $1`, [userId])).rows[0];
  return { email: user.email, isDemo: user.is_demo, verified: !!user.email_verified_at, emailEnabled: user.email_enabled,
    available: env.EMAIL_ENABLED && gmailConfigured() && !!connection && !connection.last_error,
    enabled: env.EMAIL_ENABLED, isAdmin, delivery,
    ...(isAdmin ? { gmail: { configured: gmailConfigured(), connected: !!connection, sender: connection?.sender ?? null,
      error: connection?.last_error ?? null } } : {}) };
}
export async function requestEmailVerification(userId: string) {
  if (!(await emailSettings(userId)).available) throw new AppError(503, 'EMAIL_UNAVAILABLE', 'O envio de emails ainda nao esta disponivel.');
  return withTransaction(async (client) => {
    const user = (await client.query('SELECT email, is_demo, email_verified_at FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (user.is_demo) throw new AppError(403, 'DEMO_EMAIL_DISABLED', 'Contas de teste nao enviam emails.');
    if (user.email_verified_at) return { alreadyVerified: true };
    const limits = (await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS recent
      FROM email_verifications WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [userId])).rows[0];
    if (limits.total >= 3 || limits.recent) throw new AppError(429, 'EMAIL_VERIFICATION_LIMIT', 'Aguarde antes de solicitar outra confirmacao. Limite de tres por hora.');
    await client.query('UPDATE email_verifications SET used_at = coalesce(used_at, now()) WHERE user_id = $1', [userId]);
    const id = randomUUID();
    await client.query('INSERT INTO email_verifications (id, user_id, email, token_hash) VALUES ($1, $2, $3, $4)',
      [id, userId, user.email, digest(verificationToken(id))]);
    await client.query('INSERT INTO email_outbox (user_id, verification_id) VALUES ($1, $2)', [userId, id]);
    return { queued: true };
  });
}
export async function verifyEmail(userId: string, token: string) {
  await withTransaction(async (client) => {
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const result = await client.query(`UPDATE email_verifications v SET used_at = now() FROM users u
      WHERE v.user_id = $1 AND u.id = v.user_id AND NOT u.is_demo AND v.email = u.email
        AND v.token_hash = $2 AND v.used_at IS NULL AND v.expires_at > now() RETURNING v.id`, [userId, digest(token)]);
    if (!result.rowCount) throw new AppError(400, 'INVALID_EMAIL_VERIFICATION', 'Confirmacao invalida ou expirada. Entre na conta correta e solicite outro email.');
    await client.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [userId]);
  });
}
