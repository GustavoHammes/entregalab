import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { Avatar } from './Board';
import { formatDate, overdue, statuses, statusLabels, type Member, type Task } from './types';

export function Dashboard({ tasks, members, onEdit, onList }: { tasks: Task[]; members: Member[]; onEdit: (task: Task) => void; onList: () => void }) {
  const completed = tasks.filter((task) => task.status === 'done').length;
  const counts = statuses.map((status) => ({ status, count: tasks.filter((task) => task.status === status).length }));
  const max = Math.max(1, ...counts.map((item) => item.count));
  const metrics = [
    { label: 'Pendentes', count: tasks.length - completed, color: 'blue', detail: `${tasks.length ? Math.round(completed / tasks.length * 100) : 0}% concluido` },
    { label: 'Concluidas', count: completed, color: 'green', detail: 'Entregas finalizadas' },
    { label: 'Em revisao', count: counts[2].count, color: 'amber', detail: 'Aguardando validacao' },
    { label: 'Atrasadas', count: tasks.filter(overdue).length, color: 'red', detail: 'Precisam de atencao' }
  ];
  return <div className="dashboard">
    <div className="metrics">{metrics.map((item) => <article key={item.label} className={`metric ${item.color}`}><span>{item.label}</span><strong>{item.count}</strong><small>{item.detail}</small></article>)}</div>
    <div className="dashboard-columns">
      <section className="dashboard-section"><div className="section-heading"><h3>Distribuicao das tarefas</h3><span className="muted">{tasks.length} no total</span></div>
        <div className="bar-chart">{counts.map((item) => <div className="bar-item" key={item.status}><strong>{item.count}</strong><div className="bar-track"><span className={item.status} style={{ height: `${item.count / max * 100}%` }} /></div><small>{statusLabels[item.status]}</small></div>)}</div>
      </section>
      <section className="dashboard-section"><div className="section-heading"><h3>Tarefas por pessoa</h3><span className="muted">{members.length} membros</span></div>
        <div className="user-list">{members.map((member) => <div className="user-row" key={member.id}><Avatar name={member.name} /><div><strong>{member.name}</strong><small>{member.role === 'leader' ? 'Lider' : 'Membro'}</small></div><b>{tasks.filter((task) => task.assigneeId === member.id).length}</b></div>)}</div>
      </section>
    </div>
    <section className="dashboard-section recent"><div className="section-heading"><h3>Atualizadas recentemente</h3><button className="text-button" onClick={onList}>Ver lista<ArrowUpRight size={16} /></button></div>
      {tasks.length ? [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map((task) => <button className="recent-row" key={task.id} onClick={() => onEdit(task)}><span className={`status-dot ${task.status}`} /><strong>{task.title}</strong><span>{statusLabels[task.status]}</span><span className={overdue(task) ? 'overdue' : ''}><CalendarDays size={14} />{formatDate(task.dueDate)}</span></button>) : <div className="empty-state">Seu projeto esta pronto para receber a primeira tarefa.</div>}
    </section>
  </div>;
}
