import { useEffect, useState } from 'react';
import { ArrowUpRight, FlaskConical, RotateCcw } from 'lucide-react';
import { api } from './api';
import { Modal } from './Modal';
import type { Project } from './types';

export function Demo({ projects, onOpen, onRefresh }: { projects: Project[]; onOpen: (id: string) => void; onRefresh: () => Promise<Project[]> }) {
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  useEffect(() => { onRefresh().catch((error) => setError(error.message)); }, [onRefresh]);
  const examples = projects.filter((project) => project.isDemo);
  async function seed(reset: boolean) {
    setPending(true); setError('');
    try { await api(`/demo/${reset ? 'reset' : 'projects'}`, { method: 'POST' }); await onRefresh(); setConfirm(false); }
    catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <section className="demo-workspace">
    <div className="section-heading"><h3>Projetos de exemplo</h3>{!!examples.length && <button className="secondary-button" disabled={pending} onClick={() => setConfirm(true)}><RotateCcw size={16} />Restaurar exemplos</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    {!examples.length ? <div className="empty-state"><FlaskConical size={32} /><h2>Seu laboratorio esta vazio</h2><button className="primary-button" disabled={pending} onClick={() => void seed(false)}>{pending ? 'Preparando...' : 'Carregar projetos de exemplo'}</button></div> : <>
      <div className="metrics"><article className="metric blue"><span>Projetos</span><strong>{examples.length}</strong><small>Ambiente de teste</small></article><article className="metric green"><span>Tarefas</span><strong>{examples.reduce((sum, item) => sum + item.taskCount, 0)}</strong><small>Dados de exemplo</small></article><article className="metric amber"><span>Concluidas</span><strong>{examples.reduce((sum, item) => sum + item.completedCount, 0)}</strong><small>Progresso registrado</small></article><article className="metric red"><span>Seu papel</span><strong className="metric-role">Administrador</strong><small>Lider dos projetos de teste</small></article></div>
      <div className="demo-projects">{examples.map((project) => <article className="demo-project" key={project.id}><div><span className="pill demo-pill">Teste</span><h3>{project.name}</h3><p>{project.description}</p><div className="demo-project-meta"><span>{project.taskCount} tarefas</span><span>{project.memberCount} membros</span><span>{project.taskCount ? Math.round(project.completedCount / project.taskCount * 100) : 0}% concluido</span></div></div><button className="primary-button" disabled={pending} onClick={() => onOpen(project.id)}>Abrir projeto<ArrowUpRight size={16} /></button></article>)}</div>
    </>}
    {confirm && <Modal title="Restaurar projetos de exemplo" onClose={() => { if (!pending) setConfirm(false); }}><p>As alteracoes dos projetos de teste serao substituidas pelos exemplos iniciais. Seus projetos pessoais serao preservados.</p><div className="form-actions"><button className="secondary-button" disabled={pending} onClick={() => setConfirm(false)}>Cancelar</button><button className="primary-button" disabled={pending} onClick={() => void seed(true)}><RotateCcw size={16} />{pending ? 'Restaurando...' : 'Restaurar'}</button></div></Modal>}
  </section>;
}
