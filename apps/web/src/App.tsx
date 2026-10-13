import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Bell, FlaskConical, Columns3, LayoutDashboard, ListTodo, LogOut, Moon, Plus, RefreshCw, Search, Settings2, Sun, Trash2, Users, Layers3 } from 'lucide-react';
import { api, ApiError, json } from './api';
import { Auth } from './Auth';
import { Avatar, Board, TaskList } from './Board';
import { Dashboard } from './Dashboard';
import { Modal } from './Modal';
import { TaskEditor } from './TaskEditor';
import { Demo } from './Demo';
import { Notifications } from './Notifications';
import { overdue, priorityLabels, today, type Member, type Project, type Status, type Task, type User, type View } from './types';
import './styles.css';

const navigation = [{ id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard }, { id: 'board' as const, label: 'Board', icon: Columns3 }, { id: 'list' as const, label: 'List', icon: ListTodo }, { id: 'demo' as const, label: 'Laboratorio', icon: FlaskConical }, { id: 'notifications' as const, label: 'Notificacoes', icon: Bell }];
function getView(): View { const view = window.location.hash.slice(1); return navigation.some((item) => item.id === view) ? view as View : 'dashboard'; }

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<View>(getView);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [due, setDue] = useState('all');
  const [editor, setEditor] = useState<{ task: Task | null; status: Status } | null>(null);
  const [projectEditor, setProjectEditor] = useState<'new' | 'edit' | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('entregalab.theme') === 'dark');
  const sequence = useRef(0);
  const notificationTarget = useRef<string | null>(null);
  const project = projects.find((item) => item.id === projectId);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('entregalab.theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    const onHash = () => setView(getView());
    const expired = () => { setUser(null); setEditor(null); setTeamOpen(false); setProjectEditor(null); setConfirmation(null); };
    window.addEventListener('hashchange', onHash); window.addEventListener('session-expired', expired);
    api<{ user: User }>('/auth/me').then((data) => setUser(data.user)).catch((error) => { if (!(error instanceof ApiError && error.status === 401)) setError(error.message); }).finally(() => setChecking(false));
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('session-expired', expired); };
  }, []);
  const reloadProjects = useCallback(async () => {
    const data = await api<{ projects: Project[] }>('/projects');
    setProjects(data.projects);
    setProjectId((current) => data.projects.some((project) => project.id === current) ? current : data.projects[0]?.id ?? '');
    return data.projects;
  }, []);
  useEffect(() => {
    if (user) { setLoading(true); reloadProjects().catch((error) => setError(error.message)).finally(() => setLoading(false)); }
    else { setProjects([]); setProjectId(''); setTasks([]); setMembers([]); }
  }, [user, reloadProjects]);
  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let active = true;
    const refresh = async () => { const data = await api<{ unreadCount: number }>('/notifications'); if (active) setUnreadCount(data.unreadCount); };
    api('/notifications/check-deadlines', { method: 'POST' }).then(refresh).catch(() => {});
    const timer = window.setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [user]);
  const reloadWorkspace = useCallback(async () => {
    if (!projectId || !user) return;
    const request = ++sequence.current;
    const [taskData, memberData] = await Promise.all([api<{ tasks: Task[] }>(`/projects/${projectId}/tasks`), api<{ members: Member[] }>(`/projects/${projectId}/members`)]);
    if (request === sequence.current) { setTasks(taskData.tasks); setMembers(memberData.members); }
  }, [projectId, user]);
  useEffect(() => {
    ++sequence.current; setTasks([]); setMembers([]); setQuery(''); setPriority('all'); setAssignee('all'); setDue('all');
    if (!projectId) return;
    setLoading(true); setError('');
    reloadWorkspace().catch((error) => setError(error.message)).finally(() => setLoading(false));
    const timer = window.setInterval(() => { if (!document.hidden) reloadWorkspace().catch(() => {}); }, 30000);
    return () => { ++sequence.current; window.clearInterval(timer); };
  }, [projectId, reloadWorkspace]);
  useEffect(() => {
    if (!loading && notificationTarget.current) {
      const target = tasks.find((task) => task.id === notificationTarget.current);
      if (target) { setEditor({ task: target, status: target.status }); notificationTarget.current = null; }
    }
  }, [tasks, loading]);

  async function perform(action: () => Promise<void>) {
    setPending(true); setError('');
    try { await action(); } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  function navigate(next: View) { window.location.hash = next; setView(next); }
  const filtered = useMemo(() => tasks.filter((task) => {
    const text = query.trim().toLocaleLowerCase('pt-BR');
    const name = members.find((member) => member.id === task.assigneeId)?.name ?? '';
    const date = new Date(); date.setDate(date.getDate() + 7);
    const nextWeek = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return (!text || `${task.title} ${task.description} ${name}`.toLocaleLowerCase('pt-BR').includes(text))
      && (priority === 'all' || task.priority === priority) && (assignee === 'all' || task.assigneeId === assignee || (assignee === 'none' && !task.assigneeId))
      && (due === 'all' || (due === 'overdue' && overdue(task)) || (due === 'week' && !!task.dueDate && task.dueDate >= today() && task.dueDate <= nextWeek));
  }), [tasks, members, query, priority, assignee, due]);
  const progress = tasks.length ? Math.round(tasks.filter((task) => task.status === 'done').length / tasks.length * 100) : 0;
  function deleteTask(task: Task) {
    setConfirmation({ title: 'Excluir tarefa', message: `Excluir "${task.title}" e seus comentarios?`, action: async () => {
      await api(`/projects/${projectId}/tasks/${task.id}`, { method: 'DELETE' }); await reloadWorkspace(); setConfirmation(null);
    } });
  }
  function moveTask(task: Task, status: Status, beforeId: string | null = null) {
    void perform(async () => { await api(`/projects/${projectId}/tasks/${task.id}/move`, json('POST', { status, beforeId })); await reloadWorkspace(); });
  }
  async function refresh() { await reloadProjects(); await reloadWorkspace(); }
  if (checking) return <main className="loading-page">Carregando EntregaLab...</main>;
  if (!user) return <><Auth onLogin={(user) => { setError(''); setUser(user); }} />{error && <div role="alert" className="connection-error">{error}<button className="text-button" onClick={() => window.location.reload()}>Tentar novamente</button></div>}</>;
  const boardProps = { tasks: filtered, members, pending, onAdd: (status: Status) => setEditor({ task: null, status }), onEdit: (task: Task) => setEditor({ task, status: task.status }), onDelete: deleteTask, onMove: moveTask };
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><Layers3 size={25} /><strong>EntregaLab</strong></div><span className="workspace-label">Espaco de trabalho</span>
      <nav className="primary-nav" aria-label="Navegacao principal">{navigation.map(({ id, label, icon: Icon }) => <button key={id} aria-current={view === id ? 'page' : undefined} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19} />{label}</button>)}</nav>
      <div className="project-selector"><div className="section-heading"><span>Projetos</span><button className="icon-button" title="Novo projeto" aria-label="Novo projeto" disabled={pending} onClick={() => setProjectEditor('new')}><Plus size={17} /></button></div>
        <select aria-label="Projeto atual" value={projectId} disabled={pending} onChange={(event) => setProjectId(event.target.value)}>{!projects.length && <option value="">Nenhum projeto</option>}{projects.map((project) => <option key={project.id} value={project.id}>{project.isDemo ? '[Teste] ' : ''}{project.name}</option>)}</select>
      </div>
      {project && <div className="project-progress"><div><span>Progresso do projeto</span><strong>{progress}%</strong></div><progress value={progress} max={100} /></div>}
      <div className="sidebar-bottom"><button className="theme-button" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}{dark ? 'Tema claro' : 'Tema escuro'}</button>
        <div className="account"><Avatar name={user.name} /><div><strong>{user.name}</strong><small>{user.isDemo ? 'Sessao de teste (24h)' : user.email}</small></div><button className="icon-button" title="Sair" aria-label="Sair" disabled={pending} onClick={() => void perform(async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); })}><LogOut size={17} /></button></div>
      </div>
    </aside>
    <main className="content"><header className="topbar"><div className="page-title"><p className="eyebrow">{view === 'demo' ? 'Administracao de teste' : view === 'notifications' ? 'Sua caixa de entrada' : project?.name ?? 'Seus projetos'}</p><h1>{navigation.find((item) => item.id === view)?.label}</h1>{project?.sprintEnd && view !== 'demo' && view !== 'notifications' && <small className="muted">{project.isDemo && <span className="pill demo-pill">Teste</span>} Sprint ate {new Date(`${project.sprintEnd}T12:00:00`).toLocaleDateString('pt-BR')}</small>}</div>
      <div className="toolbar"><button className="icon-button" title="Atualizar" aria-label="Atualizar" disabled={pending || loading} onClick={() => void perform(refresh)}><RefreshCw size={18} className={pending ? 'spinning' : ''} /></button>
        <button className="icon-button mobile-lab-button" title="Laboratorio" aria-label="Laboratorio" onClick={() => navigate('demo')}><FlaskConical size={18} /></button>
        <button className="icon-button notification-button" title="Notificacoes" aria-label={`Notificacoes${unreadCount ? `, ${unreadCount} nao lidas` : ''}`} onClick={() => navigate('notifications')}><Bell size={18} />{!!unreadCount && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
        {project && view !== 'demo' && view !== 'notifications' && <><button className="icon-button" title="Equipe" aria-label="Equipe" disabled={pending || loading} onClick={() => setTeamOpen(true)}><Users size={18} /></button>{project.role === 'leader' && <button className="icon-button" title="Editar projeto" aria-label="Editar projeto" disabled={pending || loading} onClick={() => setProjectEditor('edit')}><Settings2 size={18} /></button>}<button className="primary-button" title="Nova tarefa" aria-label="Nova tarefa" disabled={pending || loading} onClick={() => setEditor({ task: null, status: 'todo' })}><Plus size={18} /><span>Nova tarefa</span></button></>}
      </div></header>
      {error && <div role="alert" className="error">{error}<button className="text-button" onClick={() => void perform(refresh)}>Tentar novamente</button></div>}
      {(view === 'board' || view === 'list') && project && <section className="filters" aria-label="Filtros de tarefas"><label className="search-field"><Search size={18} /><input aria-label="Buscar tarefas" type="search" value={query} placeholder="Buscar tarefa..." onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Filtrar prioridade" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">Todas as prioridades</option>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="Filtrar responsavel" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">Todos os responsaveis</option><option value="none">Sem responsavel</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
        <select aria-label="Filtrar prazo" value={due} onChange={(event) => setDue(event.target.value)}><option value="all">Todos os prazos</option><option value="overdue">Atrasadas</option><option value="week">Proximos 7 dias</option></select>
      </section>}
      {view === 'demo' ? <Demo projects={projects} onRefresh={reloadProjects} onOpen={(id) => { setProjectId(id); navigate('board'); }} /> : view === 'notifications' ? <Notifications onCount={setUnreadCount} onOpen={(id, taskId) => { notificationTarget.current = taskId; setProjectId(id); navigate('board'); if (taskId && id === projectId) { const task = tasks.find((task) => task.id === taskId); if (task) { notificationTarget.current = null; setEditor({ task, status: task.status }); } } }} /> : loading ? <div className="empty-state" role="status">Carregando projeto...</div> : !project ? <div className="empty-state"><Layers3 size={32} /><h2>Novo projeto, novas entregas</h2><button className="primary-button" onClick={() => setProjectEditor('new')}><Plus size={17} />Criar projeto</button></div> : <>
        {view === 'dashboard' && <Dashboard tasks={tasks} members={members} onEdit={boardProps.onEdit} onList={() => navigate('list')} />}
        {view === 'board' && <Board {...boardProps} />}{view === 'list' && <TaskList {...boardProps} />}
      </>}
    </main>
    <nav className="mobile-nav" aria-label="Navegacao mobile">{navigation.slice(0, 3).map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} aria-label={label} onClick={() => navigate(id)}><Icon size={20} /><small>{label}</small></button>)}<button aria-label="Nova tarefa" disabled={!project || loading || pending} onClick={() => setEditor({ task: null, status: 'todo' })}><Plus size={22} /><small>Nova</small></button></nav>
    {editor && project && <TaskEditor key={editor.task?.id ?? 'new'} task={editor.task} status={editor.status} projectId={projectId} members={members} onClose={() => setEditor(null)} onSaved={reloadWorkspace} />}
    {projectEditor && <ProjectEditor project={projectEditor === 'edit' ? project : undefined} onClose={() => setProjectEditor(null)} onSaved={async (id) => { await reloadProjects(); setProjectId(id); setProjectEditor(null); }} onDelete={project ? () => setConfirmation({ title: 'Excluir projeto', message: `Excluir "${project.name}"? Todas as tarefas, membros e comentarios deste projeto serao removidos.`, action: async () => { await api(`/projects/${project.id}`, { method: 'DELETE' }); setProjectEditor(null); setConfirmation(null); await reloadProjects(); } }) : undefined} />}
    {teamOpen && project && <TeamEditor project={project} members={members} onClose={() => setTeamOpen(false)} onSaved={reloadWorkspace} />}
    {confirmation && <Modal title={confirmation.title} onClose={() => { if (!pending) setConfirmation(null); }}><p>{confirmation.message}</p>{error && <p className="error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary-button" disabled={pending} onClick={() => setConfirmation(null)}>Cancelar</button><button className="danger-button" disabled={pending} onClick={() => void perform(confirmation.action)}><Trash2 size={17} />{pending ? 'Excluindo...' : 'Excluir'}</button></div></Modal>}
  </div>;
}

function ProjectEditor({ project, onClose, onSaved, onDelete }: { project?: Project; onClose: () => void; onSaved: (id: string) => Promise<void>; onDelete?: () => void }) {
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setPending(true); setError('');
    try {
      const result = await api<{ project: Project }>(`/projects${project ? `/${project.id}` : ''}`, json(project ? 'PATCH' : 'POST', { name: data.get('name'), description: data.get('description'), sprintStart: data.get('start') || undefined, sprintEnd: data.get('end') || undefined }));
      await onSaved(result.project.id);
    } catch (error) { setError((error as Error).message); } finally { setPending(false); }
  }
  return <Modal title={project ? 'Editar projeto' : 'Novo projeto'} onClose={() => { if (!pending) onClose(); }}><form className="editor-form" onSubmit={submit}><fieldset disabled={pending}>
    <label>Nome<input name="name" required minLength={2} maxLength={140} autoFocus defaultValue={project?.name} /></label><label>Descricao<textarea name="description" rows={3} maxLength={1000} defaultValue={project?.description ?? ''} /></label><div className="form-grid"><label>Inicio da sprint<input name="start" type="date" defaultValue={project?.sprintStart ?? ''} /></label><label>Fim da sprint<input name="end" type="date" defaultValue={project?.sprintEnd ?? ''} /></label></div>
    {error && <p role="alert" className="error">{error}</p>}<div className="form-actions">{project && <button className="danger-button" type="button" onClick={onDelete}><Trash2 size={16} />Excluir</button>}<button className="primary-button">{pending ? 'Salvando...' : 'Salvar projeto'}</button></div>
  </fieldset></form></Modal>;
}
function TeamEditor({ project, members, onClose, onSaved }: { project: Project; members: Member[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [email, setEmail] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  async function act(action: () => Promise<void>) { setPending(true); setError(''); try { await action(); await onSaved(); } catch (error) { setError((error as Error).message); } finally { setPending(false); } }
  return <Modal title="Equipe do projeto" onClose={() => { if (!pending) onClose(); }}><div className="user-list">{members.map((member) => <div className="user-row" key={member.id}><Avatar name={member.name} /><div><strong>{member.name}</strong><small>{member.email} - {member.role === 'leader' ? 'Lider' : 'Membro'}</small></div>{project.role === 'leader' && member.role !== 'leader' && <button className="icon-button" title="Remover membro" aria-label={`Remover ${member.name}`} disabled={pending} onClick={() => void act(async () => { await api(`/projects/${project.id}/members/${member.id}`, { method: 'DELETE' }); })}><Trash2 size={16} /></button>}</div>)}</div>
    {project.role === 'leader' && <form className="member-form" onSubmit={(event) => { event.preventDefault(); void act(async () => { await api(`/projects/${project.id}/members`, json('POST', project.isDemo ? { name: email } : { email })); setEmail(''); }); }}><label>{project.isDemo ? 'Nome do membro ficticio' : 'Email do novo membro'}<input type={project.isDemo ? 'text' : 'email'} value={email} onChange={(event) => setEmail(event.target.value)} required minLength={project.isDemo ? 2 : undefined} disabled={pending} placeholder={project.isDemo ? 'Nome de exemplo' : 'colega@exemplo.com'} /></label><button className="primary-button" disabled={pending}><Plus size={17} />Adicionar membro</button></form>}
    {error && <p role="alert" className="error">{error}</p>}
  </Modal>;
}
