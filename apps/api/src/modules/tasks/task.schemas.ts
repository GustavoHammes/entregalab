import { z } from 'zod';

export const projectParams = z.object({ projectId: z.string().uuid() });
export const taskParams = projectParams.extend({ taskId: z.string().uuid() });
export const taskStatus = z.enum(['todo', 'in_progress', 'in_review', 'done']);
export const taskFields = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(5000).default(''),
  status: taskStatus.default('todo'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().date().nullable().default(null),
  assigneeId: z.string().uuid().nullable().default(null)
}).strict();
export const updateTaskBody = taskFields.partial().refine((body) => Object.keys(body).length > 0, 'Informe ao menos um campo.');
export const moveTaskBody = z.object({ status: taskStatus, beforeId: z.string().uuid().nullable().default(null) }).strict();
export const commentBody = z.object({ body: z.string().trim().min(1).max(2000) }).strict();
