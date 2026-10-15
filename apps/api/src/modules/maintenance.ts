import type { FastifyInstance } from 'fastify';
import { cleanupExpiredDemos } from './demo/demo.repository.js';
import { generateDeadlineReminders } from './notifications/notification.repository.js';
import { query } from '../db/pool.js';

export function startMaintenance(app: FastifyInstance) {
  let running: Promise<void> | null = null;
  function tick() {
    if (running) return;
    running = (async () => {
      await cleanupExpiredDemos();
      await generateDeadlineReminders();
      await query('DELETE FROM gmail_oauth_flows WHERE expires_at < now()');
      await query("DELETE FROM email_verifications WHERE created_at < now() - interval '2 days'");
      await query("DELETE FROM email_outbox WHERE status IN ('sent', 'failed', 'cancelled') AND created_at < now() - interval '30 days'");
    })().catch((error) => app.log.error(error, 'Maintenance failed')).finally(() => { running = null; });
  }
  const timer = setInterval(tick, 5 * 60 * 1000);
  timer.unref(); tick();
  return async () => { clearInterval(timer); if (running) await running; };
}
