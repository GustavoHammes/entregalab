import { z } from 'zod';

export const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(2).max(140),
    description: z.string().trim().max(1000).optional(),
    sprintStart: z.string().date().optional(),
    sprintEnd: z.string().date().optional()
  }).strict()
  .refine(
    (data) => {
      if (!data.sprintStart || !data.sprintEnd) {
        return true;
      }

      return data.sprintEnd >= data.sprintStart;
    },
    {
      message: 'Sprint end date must be on or after the start date.',
      path: ['sprintEnd']
    }
  );
