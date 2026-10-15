export type Status = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export type View = 'dashboard' | 'board' | 'list' | 'demo' | 'notifications';
export type User = { id: string; name: string; email: string; isDemo?: boolean };
export type Member = User & { role: 'leader' | 'member' };
export type Project = { id: string; name: string; description: string | null; role: 'leader' | 'member';
  sprintStart: string | null; sprintEnd: string | null; taskCount: number; memberCount: number; isDemo: boolean; completedCount: number };
export type Task = { id: string; projectId: string; title: string; description: string; status: Status; priority: Priority;
  dueDate: string | null; assigneeId: string | null; position: number; comments: number; createdAt: string; updatedAt: string };
export type TaskInput = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'assigneeId'>;
export type ProgressPoint = { date: string; total: number; completed: number };
export type Comment = { id: string; body: string; authorName: string; createdAt: string };
export type Notification = { id: string; projectId: string; taskId: string | null; projectName: string; kind: 'project' | 'task' | 'due'; title: string; body: string; readAt: string | null; createdAt: string; isDemo: boolean };
export type NotificationPreferences = { projectUpdates: boolean; taskChanges: boolean; dueReminders: boolean; emailEnabled: boolean };
export type EmailSettings = { email: string; isDemo: boolean; verified: boolean; emailEnabled: boolean; available: boolean;
  enabled: boolean; isAdmin: boolean; delivery: { pending: number; failed: number; sent: number };
  gmail?: { configured: boolean; connected: boolean; sender: string | null; error: string | null } };

export const statuses: Status[] = ['todo', 'in_progress', 'in_review', 'done'];
export const statusLabels: Record<Status, string> = { todo: 'A fazer', in_progress: 'Em andamento', in_review: 'Em revisao', done: 'Concluido' };
export const priorityLabels: Record<Priority, string> = { low: 'Baixa', medium: 'Media', high: 'Alta' };
export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function overdue(task: Task) { return !!task.dueDate && task.status !== 'done' && task.dueDate < today(); }
export function formatDate(date: string | null) {
  return date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`)) : 'Sem prazo';
}
