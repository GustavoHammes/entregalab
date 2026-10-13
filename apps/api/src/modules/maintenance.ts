import type { FastifyInstance } from 'fastify';
import { cleanupExpiredDemos } from './demo/demo.repository.js';
import { generateDeadlineReminders } from './notifications/notification.repository.js';

export function startMaintenance(app: FastifyInstance) {
  let running: Promise<void> | null = null;
  function tick() {
    if (running) return;
    running = (async () => {
      await cleanupExpiredDemos();
      await generateDeadlineReminders();
    })().catch((error) => app.log.error(error, 'Maintenance failed')).finally(() => { running = null; });
  }
  const timer = setInterval(tick, 5 * 60 * 1000);
  timer.unref(); tick();
  return async () => { clearInterval(timer); if (running) await running; };
}
