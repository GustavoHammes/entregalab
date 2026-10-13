import { useEffect, useState } from 'react';
import { ArrowUpRight, Bell, Check, CheckCheck, RefreshCw } from 'lucide-react';
import { api, json } from './api';
import type { Notification, NotificationPreferences } from './types';

export function Notifications({ onOpen, onCount }: { onOpen: (projectId: string, taskId: string | null) => void; onCount: (count: number) => void }) {
  const [items, setItems] = useState<Notification[]>([]); const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [onlyUnread, setOnlyUnread] = useState(false);
  async function load() {
    const data = await api<{ notifications: Notification[]; unreadCount: number }>('/notifications');
    setItems(data.notifications); onCount(data.unreadCount);
  }
  async function act(action: () => Promise<void>) { setPending(true); setError(''); try { await action(); } catch (error) { setError((error as Error).message); } finally { setPending(false); } }
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const data = await api<{ notifications: Notification[]; unreadCount: number }>('/notifications');
      if (active) { setItems(data.notifications); onCount(data.unreadCount); }
    };
    setPending(true);
    Promise.all([refresh(), api<{ preferences: NotificationPreferences }>('/notifications/preferences').then((data) => { if (active) setPreferences(data.preferences); })])
      .catch((error) => { if (active) setError(error.message); }).finally(() => { if (active) setPending(false); });
    const timer = window.setInterval(() => { if (!document.hidden) refresh().catch((error) => { if (active) setError(error.message); }); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [onCount]);
  async function toggle(key: keyof NotificationPreferences, value: boolean) {
    await act(async () => { const data = await api<{ preferences: NotificationPreferences }>('/notifications/preferences', json('PATCH', { [key]: value })); setPreferences(data.preferences); });
  }
  return <div className="notifications-layout"><section className="notification-inbox"><div className="section-heading"><h3>Caixa de entrada</h3><div className="toolbar"><button className="icon-button" title="Atualizar notificacoes" aria-label="Atualizar notificacoes" disabled={pending} onClick={() => void act(async () => { await api('/notifications/check-deadlines', { method: 'POST' }); await load(); })}><RefreshCw size={17} /></button><button className="secondary-button" disabled={pending || !items.some((item) => !item.readAt)} onClick={() => void act(async () => { await api('/notifications/read-all', { method: 'POST' }); await load(); })}><CheckCheck size={17} />Marcar todas como lidas</button></div></div>
      <label className="checkbox-label"><input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />Somente nao lidas</label>
      {error && <p className="error" role="alert">{error}</p>}
      {pending && !items.length ? <div className="empty-state">Carregando notificacoes...</div> : !items.filter((item) => !onlyUnread || !item.readAt).length ? <div className="empty-state"><Bell size={28} />Nenhuma notificacao por aqui.</div> : items.filter((item) => !onlyUnread || !item.readAt).map((item) => <article className={`notification-item ${!item.readAt ? 'unread' : ''}`} key={item.id}><div><div className="notification-meta"><span>{item.projectName}</span>{item.isDemo && <span className="pill demo-pill">Teste</span>}<time>{new Date(item.createdAt).toLocaleString('pt-BR')}</time></div><h3>{item.title}</h3><p>{item.body}</p><button className="text-button" disabled={pending} onClick={() => void act(async () => { await api(`/notifications/${item.id}/read`, { method: 'PATCH' }); await load(); onOpen(item.projectId, item.taskId); })}>Abrir<ArrowUpRight size={15} /></button></div>{!item.readAt && <button className="icon-button" title="Marcar como lida" aria-label={`Marcar ${item.title} como lida`} disabled={pending} onClick={() => void act(async () => { await api(`/notifications/${item.id}/read`, { method: 'PATCH' }); await load(); })}><Check size={17} /></button>}</article>)}
    </section><aside className="notification-preferences"><h3>Preferencias</h3>{preferences && <>{([{ key: 'projectUpdates', label: 'Projetos e equipe' }, { key: 'taskChanges', label: 'Tarefas e comentarios' }, { key: 'dueReminders', label: 'Prazos e atrasos' }] as const).map((item) => <label key={item.key} className="checkbox-label"><input type="checkbox" disabled={pending} checked={preferences[item.key]} onChange={(event) => void toggle(item.key, event.target.checked)} />{item.label}</label>)}</>}</aside></div>;
}
