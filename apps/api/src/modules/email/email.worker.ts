import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/pool.js';
import { digest, unseal, verificationToken } from './email.crypto.js';
import { appUrl, emailErrorCode, gmailConfigured, gmailSender, type EmailMessage } from './gmail.js';

type Job = { id: string; user_id: string; notification_id: string | null; verification_id: string | null; attempts: number; created_at: Date };
async function claimJob(): Promise<Job | null> {
  return withTransaction(async (client) => {
    await client.query(`UPDATE email_outbox SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
      lease_until = NULL WHERE status = 'processing' AND lease_until < now()`);
    const candidate = (await client.query<Job>(`SELECT * FROM email_outbox WHERE status = 'pending'
      AND next_attempt_at <= now() AND attempts < 5 ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!candidate) return null;
    return (await client.query<Job>(`UPDATE email_outbox SET status = 'processing', attempts = attempts + 1,
      lease_until = now() + interval '2 minutes' WHERE id = $1 RETURNING *`, [candidate.id])).rows[0];
  });
}
async function resolveMessage(job: Job): Promise<EmailMessage | null> {
  if (job.verification_id) {
    const row = (await query(`SELECT v.id, v.token_hash, u.email FROM email_verifications v JOIN users u ON u.id = v.user_id
      WHERE v.id = $1 AND u.id = $2 AND v.email = u.email AND NOT u.is_demo AND u.email_verified_at IS NULL
        AND v.used_at IS NULL AND v.expires_at > now()`, [job.verification_id, job.user_id])).rows[0];
    if (!row) return null;
    const token = verificationToken(row.id);
    if (digest(token) !== row.token_hash) return null;
    return { id: job.id, to: row.email, subject: 'Confirme seu email no EntregaLab',
      text: `Confirme seu endereco entrando na sua conta do EntregaLab e abrindo este link:\n\n${appUrl()}/#notifications?verify=${encodeURIComponent(token)}\n\nO link expira em uma hora. Confirmar o endereco nao ativa notificacoes por email automaticamente.\n\nSe voce nao solicitou este email, ignore esta mensagem.` };
  }
  if (Date.now() - job.created_at.getTime() > 48 * 60 * 60 * 1000) return null;
  const row = (await query(`SELECT u.email, n.title, n.body, p.name AS project_name FROM notifications n
    JOIN users u ON u.id = n.user_id JOIN projects p ON p.id = n.project_id
    JOIN project_members m ON m.project_id = p.id AND m.user_id = u.id
    JOIN notification_preferences pref ON pref.user_id = u.id LEFT JOIN tasks t ON t.id = n.task_id
    WHERE n.id = $1 AND u.id = $2 AND NOT u.is_demo AND NOT p.is_demo AND u.email_verified_at IS NOT NULL
      AND pref.email_enabled AND CASE n.kind WHEN 'project' THEN pref.project_updates WHEN 'task' THEN pref.task_changes ELSE pref.due_reminders END
      AND (n.kind <> 'due' OR (n.read_at IS NULL AND t.status <> 'done'
        AND n.dedupe_key = 'due:' || t.id || ':' || to_char(t.due_date, 'YYYY-MM-DD')))` , [job.notification_id, job.user_id])).rows[0];
  if (!row) return null;
  return { id: job.id, to: row.email, subject: `[EntregaLab] ${row.title}`,
    text: `${row.title}\nProjeto: ${row.project_name}\n\n${row.body}\n\nAbrir notificacoes: ${appUrl()}/#notifications\n\nVoce pode desativar estes emails nas preferencias de notificacoes do EntregaLab.` };
}
export async function processEmailQueue(sendOverride?: (message: EmailMessage) => Promise<string>, limit = 10) {
  if (!env.EMAIL_ENABLED || !gmailConfigured()) return 0;
  const connection = (await query('SELECT sender, refresh_token_encrypted, last_error FROM gmail_connection WHERE id = 1')).rows[0];
  if (!connection || connection.last_error) return 0;
  let send: (message: EmailMessage) => Promise<string>;
  try { send = sendOverride ?? gmailSender(connection.sender, unseal(connection.refresh_token_encrypted)); }
  catch { await query("UPDATE gmail_connection SET last_error = 'GMAIL_REAUTH_REQUIRED' WHERE id = 1"); return 0; }
  let sent = 0;
  for (let index = 0; index < limit; index++) {
    const job = await claimJob(); if (!job) break;
    try {
      const message = await resolveMessage(job);
      if (!message) { await query("UPDATE email_outbox SET status = 'cancelled', lease_until = NULL WHERE id = $1", [job.id]); continue; }
      const budget = await query(`INSERT INTO email_daily_usage (day, attempts) VALUES ((now() AT TIME ZONE 'UTC')::date, 1)
        ON CONFLICT (day) DO UPDATE SET attempts = email_daily_usage.attempts + 1
        WHERE email_daily_usage.attempts < $1 RETURNING attempts`, [env.EMAIL_MAX_PER_DAY]);
      if (!budget.rowCount) {
        await query(`UPDATE email_outbox SET status = 'pending', attempts = attempts - 1, lease_until = NULL,
          next_attempt_at = date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day' WHERE id = $1`, [job.id]);
        break;
      }
      const id = await send(message);
      await query(`UPDATE email_outbox SET status = 'sent', sent_at = now(), provider_id = $2,
        lease_until = NULL, last_error = NULL WHERE id = $1`, [job.id, id]);
      sent++;
    } catch (error) {
      const code = emailErrorCode(error);
      await query(`UPDATE email_outbox SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
        next_attempt_at = now() + ($2::int * interval '1 minute'), lease_until = NULL, last_error = $3 WHERE id = $1`,
        [job.id, code === 'GMAIL_RATE_LIMIT' ? 60 : Math.min(60, 2 ** job.attempts), code]);
      if (code === 'GMAIL_REAUTH_REQUIRED') {
        await query('UPDATE gmail_connection SET last_error = $1 WHERE id = 1', [code]); break;
      }
      if (code === 'GMAIL_RATE_LIMIT') break;
    }
  }
  return sent;
}
export function startEmailWorker(app: FastifyInstance) {
  let running: Promise<unknown> | null = null;
  function tick() {
    if (running) return;
    running = processEmailQueue().catch(() => app.log.error('Email queue processing failed')).finally(() => { running = null; });
  }
  const timer = setInterval(tick, 30000); timer.unref(); tick();
  return async () => { clearInterval(timer); if (running) await running; };
}
