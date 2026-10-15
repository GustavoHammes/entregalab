import { useEffect, useState } from 'react';
import { Link2, Mail, RefreshCw, Unplug } from 'lucide-react';
import { api, json } from './api';
import { Modal } from './Modal';
import type { EmailSettings } from './types';

function parameters() { return new URLSearchParams(window.location.hash.split('?')[1] ?? ''); }
export function EmailPreferences() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [token, setToken] = useState(() => parameters().get('verify'));
  const [disconnecting, setDisconnecting] = useState(false);
  async function load() { setSettings(await api<EmailSettings>('/email/settings')); }
  async function act(action: () => Promise<void>) {
    setPending(true); setError(''); setMessage('');
    try { await action(); await load(); } catch (error) { setError((error as Error).message); } finally { setPending(false); }
  }
  useEffect(() => {
    let active = true;
    const refresh = () => api<EmailSettings>('/email/settings').then((data) => { if (active) setSettings(data); })
      .catch((error) => { if (active) setError(error.message); });
    const onHash = () => setToken(parameters().get('verify'));
    const result = parameters().get('gmail');
    if (result) {
      if (result === 'connected') setMessage('Gmail conectado.');
      else setError('Nao foi possivel conectar o Gmail. Confira a conta e as credenciais OAuth.');
      window.history.replaceState(null, '', '#notifications');
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    window.addEventListener('hashchange', onHash);
    return () => { active = false; clearInterval(timer); window.removeEventListener('hashchange', onHash); };
  }, []);
  return <section className="email-preferences"><h3>Email</h3>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="email-message" role="status">{message}</p>}
    {!settings ? <p className="muted">Carregando...</p> : settings.isDemo ? <p className="muted">Envio desativado para contas de teste.</p> : <>
      <p className="email-address">{settings.email}</p><p className="muted">{settings.verified ? 'Endereco confirmado' : 'Confirmacao pendente'}</p>
      {!settings.available && <p className="muted">Envio indisponivel no momento.</p>}
      {token && !settings.verified && <button className="secondary-button" disabled={pending} onClick={() => void act(async () => {
        await api('/email/verify', json('POST', { token })); setToken(null); window.history.replaceState(null, '', '#notifications'); setMessage('Endereco confirmado.');
      })}><Mail size={16} />Confirmar email</button>}
      {!settings.verified && !token && <button className="secondary-button" disabled={pending || !settings.available} onClick={() => void act(async () => {
        await api('/email/verification', { method: 'POST' }); setMessage('Confirmacao na fila de envio. Confira sua caixa de entrada e spam.');
      })}><Mail size={16} />Enviar confirmacao</button>}
      <label className="checkbox-label"><input type="checkbox" checked={settings.emailEnabled} disabled={pending || !settings.verified} onChange={(event) => {
        const enabled = event.target.checked; void act(async () => { await api('/notifications/preferences', json('PATCH', { emailEnabled: enabled })); });
      }} />Receber notificacoes por email</label>
      <dl className="email-delivery"><div><dt>Pendentes</dt><dd>{settings.delivery.pending}</dd></div><div><dt>Entregues ao Gmail</dt><dd>{settings.delivery.sent}</dd></div>{settings.delivery.failed > 0 && <div><dt>Falhas</dt><dd>{settings.delivery.failed}</dd></div>}</dl>
    </>}
    {settings?.isAdmin && settings.gmail && <section className="gmail-settings"><h4>Remetente do sistema</h4>
      <p className="email-address">{settings.gmail.sender ?? 'Gmail desconectado'}</p>
      {!settings.gmail.configured && <p className="muted">Credenciais OAuth pendentes no Render.</p>}
      {!settings.enabled && <p className="muted">Envio desativado no servidor.</p>}
      {settings.gmail.error && <p className="error" role="alert">Autorizacao expirada. Reconecte o Gmail.</p>}
      <div className="email-actions"><button className="secondary-button" disabled={pending || !settings.gmail.configured} onClick={() => void act(async () => {
        const data = await api<{ url: string }>('/email/gmail/connect', { method: 'POST' }); window.location.assign(data.url);
      })}><Link2 size={16} />{settings.gmail.connected ? 'Reconectar Gmail' : 'Conectar Gmail'}</button>
      {settings.gmail.connected && <><button className="secondary-button" disabled={pending} onClick={() => setDisconnecting(true)}><Unplug size={16} />Desconectar</button>
        <button className="secondary-button" disabled={pending || !settings.available} onClick={() => void act(async () => {
          const result = await api<{ queued: number }>('/email/gmail/retry', { method: 'POST' }); setMessage(`${result.queued} envios recolocados na fila.`);
        })}><RefreshCw size={16} />Tentar falhas novamente</button></>}
      </div>
    </section>}
    {disconnecting && <Modal title="Desconectar Gmail" onClose={() => { if (!pending) setDisconnecting(false); }}>
      <p>O envio de emails sera interrompido. As notificacoes dentro do site continuam funcionando.</p>
      {error && <p className="error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary-button" disabled={pending} onClick={() => setDisconnecting(false)}>Cancelar</button><button className="danger-button" disabled={pending} onClick={() => void act(async () => {
        await api('/email/gmail/connection', { method: 'DELETE' }); setDisconnecting(false); setMessage('Gmail desconectado.');
      })}><Unplug size={16} />Desconectar</button></div>
    </Modal>}
  </section>;
}
