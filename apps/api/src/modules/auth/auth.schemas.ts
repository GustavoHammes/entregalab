import { z } from 'zod';

const emailSchema = z
  .string().trim().toLowerCase()
  .email()
  .max(180)
  .transform((email) => email.trim().toLowerCase());

const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, 'Password must include a letter.')
  .regex(/[0-9]/, 'Password must include a number.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Senha muito longa.');

export const registerBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Senha muito longa.')
});
