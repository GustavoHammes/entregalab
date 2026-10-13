import { DndContext, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GripVertical, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, overdue, priorityLabels, statuses, statusLabels, type Member, type Status, type Task } from './types';

type Props = { tasks: Task[]; members: Member[]; pending: boolean; onAdd: (status: Status) => void; onEdit: (task: Task) => void;
  onDelete: (task: Task) => void; onMove: (task: Task, status: Status, beforeId?: string | null) => void };
export function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar" title={name} aria-label={name}>{initials}</span>;
}
export function StatusSelect({ task, pending, onMove }: Pick<Props, 'pending' | 'onMove'> & { task: Task }) {
  return <select className="status-select" aria-label={`Status de ${task.title}`} value={task.status} disabled={pending} onChange={(event) => onMove(task, event.target.value as Status)}>
    {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
  </select>;
}
function Column({ status, count, children, onAdd, disabled }: { status: Status; count: number; children: ReactNode; onAdd: () => void; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}`, data: { status }, disabled });
  return <section ref={setNodeRef} className={`column ${isOver ? 'drag-over' : ''}`} data-status={status}>
    <header><h3><span className={`status-dot ${status}`} />{statusLabels[status]}<small>{count}</small></h3><button className="icon-button" title={`Adicionar em ${statusLabels[status]}`} aria-label={`Adicionar em ${statusLabels[status]}`} onClick={onAdd} disabled={disabled}><Plus size={17} /></button></header>
    <div className="cards">{children}</div>
    <button className="add-card-button" onClick={onAdd} disabled={disabled}><Plus size={16} />Adicionar tarefa</button>
  </section>;
}
function Card({ task, ...props }: Props & { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { status: task.status }, disabled: props.pending });
  const member = props.members.find((member) => member.id === task.assigneeId);
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`task-card ${isDragging ? 'dragging' : ''}`}>
    <div className="task-card-top"><span className={`pill priority-${task.priority}`}>{priorityLabels[task.priority]}</span><div className="card-tools">
      <button className="icon-button drag-handle" title="Mover tarefa" aria-label={`Mover ${task.title}`} {...attributes} {...listeners}><GripVertical size={16} /></button>
      <button className="icon-button" title="Excluir tarefa" aria-label={`Excluir ${task.title}`} disabled={props.pending} onClick={() => props.onDelete(task)}><Trash2 size={15} /></button></div></div>
    <button className="task-title" disabled={props.pending} onClick={() => props.onEdit(task)}>{task.title}</button>
    {task.description && <p className="task-description">{task.description}</p>}
    <div className="task-meta"><span className={overdue(task) ? 'overdue' : ''}><CalendarDays size={14} />{formatDate(task.dueDate)}</span>{member ? <Avatar name={member.name} /> : <small className="muted">Sem responsavel</small>}</div>
    <footer><StatusSelect task={task} pending={props.pending} onMove={props.onMove} /><button className="comment-count" title="Ver comentarios" aria-label={`Comentarios de ${task.title}`} onClick={() => props.onEdit(task)}><MessageSquare size={14} />{task.comments}</button></footer>
  </article>;
}
export function Board(props: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function dragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || props.pending) return;
    const task = props.tasks.find((task) => task.id === active.id);
    if (!task) return;
    const target = props.tasks.find((item) => item.id === over.id);
    const status = target?.status ?? over.data.current?.status as Status;
    if (!statuses.includes(status)) return;
    let beforeId = target?.id ?? null;
    if (target && task.status === status) {
      const ids = props.tasks.filter((item) => item.status === status).map((item) => item.id);
      const next = arrayMove(ids, ids.indexOf(task.id), ids.indexOf(target.id));
      beforeId = next[next.indexOf(task.id) + 1] ?? null;
    }
    props.onMove(task, status, beforeId);
  }
  return <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={dragEnd}>
    <div className="board">{statuses.map((status) => {
      const tasks = props.tasks.filter((task) => task.status === status);
      return <Column key={status} status={status} count={tasks.length} onAdd={() => props.onAdd(status)} disabled={props.pending}>
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => <Card key={task.id} task={task} {...props} />)}
        </SortableContext>
        {!tasks.length && <p className="column-empty">Nenhuma tarefa</p>}
      </Column>;
    })}</div>
  </DndContext>;
}
export function TaskList(props: Props) {
  return <section className="task-list"><div className="section-heading"><h3>Tarefas</h3><span className="muted">{props.tasks.length} resultados</span></div>
    {props.tasks.length ? <div className="table-scroll"><table><thead><tr><th>Tarefa</th><th>Status</th><th>Prioridade</th><th>Responsavel</th><th>Prazo</th><th><span className="sr-only">Acoes</span></th></tr></thead><tbody>
      {props.tasks.map((task) => <tr key={task.id}><td><button className="task-title" disabled={props.pending} onClick={() => props.onEdit(task)}>{task.title}</button></td>
        <td><StatusSelect task={task} pending={props.pending} onMove={props.onMove} /></td><td><span className={`pill priority-${task.priority}`}>{priorityLabels[task.priority]}</span></td>
        <td>{props.members.find((member) => member.id === task.assigneeId)?.name ?? 'Sem responsavel'}</td><td className={overdue(task) ? 'overdue' : ''}>{formatDate(task.dueDate)}</td>
        <td><button className="icon-button" title="Excluir tarefa" aria-label={`Excluir ${task.title}`} onClick={() => props.onDelete(task)} disabled={props.pending}><Trash2 size={16} /></button></td></tr>)}
    </tbody></table></div> : <div className="empty-state">Nenhuma tarefa encontrada.</div>}
  </section>;
}
