import { useState, type FormEvent } from 'react';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { api, json } from './api';
import type { User } from './types';
import kanbanIcon from '../kanban.svg';

export function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function demo() {
    setPending(true); setError('');
    try {
      const data = await api<{ user: User }>('/demo/session', { method: 'POST' });
      window.location.hash = 'demo'; onLogin(data.user);
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      const body = { email: form.get('email'), password: form.get('password'), ...(register ? { name: form.get('name') } : {}) };
      const result = await api<{ user: User }>(`/auth/${register ? 'register' : 'login'}`, json('POST', body));
      onLogin(result.user);
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <main className="auth-page">
    <div className="auth-brand"><img className="brand-icon" src={kanbanIcon} alt="" width={32} height={32} /><strong>EntregaLab</strong></div>
    <section className="auth-form">
      <p className="eyebrow">Seu espaco de trabalho</p>
      <h1>{register ? 'Criar conta' : 'Entrar'}</h1>
      <form onSubmit={submit}>
        {register && <label>Nome<input name="name" autoComplete="name" required minLength={2} maxLength={120} /></label>}
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={180} /></label>
        <label>Senha<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : 1} maxLength={72} pattern={register ? '(?=.*[A-Za-z])(?=.*[0-9]).{8,}' : undefined} title={register ? 'Pelo menos 8 caracteres, uma letra e um numero.' : undefined} /></label>
        {register && <small className="muted">8 caracteres ou mais, com letra e numero.</small>}
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary-button" disabled={pending}>{pending ? 'Aguarde...' : register ? 'Criar conta' : 'Entrar'}<ArrowRight size={18} /></button>
      </form>
      <button type="button" className="text-button" disabled={pending} onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Ja tenho uma conta' : 'Criar uma conta'}</button>
      <button type="button" className="secondary-button demo-entry" disabled={pending} onClick={() => void demo()}><FlaskConical size={18} />Testar como administrador</button>
    </section>
    <footer>Faculdade, trabalho e as entregas entre eles.</footer>
  </main>;
}
