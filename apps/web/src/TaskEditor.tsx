import { useEffect, useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { api, json } from './api';
import { Modal } from './Modal';
import { priorityLabels, statuses, statusLabels, type Comment, type Member, type Status, type Task, type TaskInput } from './types';

export function TaskEditor({ task, status, projectId, members, onClose, onSaved }: { task: Task | null; status: Status; projectId: string; members: Member[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<TaskInput>(task ?? { title: '', description: '', status, priority: 'medium', dueDate: null, assigneeId: null });
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(!!task);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const path = `/projects/${projectId}/tasks${task ? `/${task.id}` : ''}`;
  useEffect(() => {
    let active = true;
    if (task) api<{ comments: Comment[] }>(`${path}/comments`).then((data) => { if (active) setComments(data.comments); }).catch((error) => { if (active) setError(error.message); }).finally(() => { if (active) setCommentsLoading(false); });
    return () => { active = false; };
  }, [path, task]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const { title, description, status, priority, assigneeId } = form;
      const dueDate = String(data.get('dueDate') ?? '') || null;
      await api(path, json(task ? 'PATCH' : 'POST', { title, description, status, priority, dueDate, assigneeId }));
      await onSaved(); onClose();
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  async function sendComment(event: FormEvent) {
    event.preventDefault(); setPending(true); setError('');
    try {
      await api(`${path}/comments`, json('POST', { body: comment }));
      setComments((await api<{ comments: Comment[] }>(`${path}/comments`)).comments); setComment(''); await onSaved();
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <Modal title={task ? 'Editar tarefa' : 'Nova tarefa'} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={save} className="editor-form"><fieldset disabled={pending}>
      <label>Titulo<input autoFocus required minLength={3} maxLength={180} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label>Descricao<textarea rows={3} maxLength={5000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <div className="form-grid"><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Status })}>{statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
        <label>Prioridade<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskInput['priority'] })}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Prazo<input name="dueDate" type="date" defaultValue={form.dueDate ?? ''} /></label>
        <label>Responsavel<select value={form.assigneeId ?? ''} onChange={(event) => setForm({ ...form, assigneeId: event.target.value || null })}><option value="">Sem responsavel</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      </div>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button">{pending ? 'Salvando...' : 'Salvar tarefa'}</button></div>
    </fieldset></form>
    {error && <p role="alert" className="error">{error}</p>}
    {task && <section className="comments"><h3>Comentarios</h3>{commentsLoading ? <p className="muted">Carregando comentarios...</p> : !comments.length ? <p className="muted">Nenhum comentario ainda.</p> : comments.map((item) => <article className="comment" key={item.id}><header><strong>{item.authorName}</strong><time>{new Date(item.createdAt).toLocaleString('pt-BR')}</time></header><p>{item.body}</p></article>)}
      <form onSubmit={sendComment}><label className="sr-only" htmlFor="new-comment">Novo comentario</label><textarea id="new-comment" rows={2} value={comment} onChange={(event) => setComment(event.target.value)} required maxLength={2000} placeholder="Escrever comentario..." disabled={pending} /><button className="icon-button" title="Enviar comentario" aria-label="Enviar comentario" disabled={pending || !comment.trim()}><Send size={18} /></button></form>
    </section>}
  </Modal>;
}
