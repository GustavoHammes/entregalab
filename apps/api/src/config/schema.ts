import { z } from 'zod';

const optionalValue = (value: unknown) => value === '' ? undefined : value;
const coreSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SECURE_COOKIES: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WEB_DIR: z.string().optional()
});

const emailSchema = z.object({
  APP_URL: z.preprocess(optionalValue, z.string().url().optional()),
  EMAIL_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  EMAIL_ADMIN_USER_ID: z.preprocess(optionalValue, z.string().uuid().optional()),
  EMAIL_TOKEN_KEY: z.preprocess(optionalValue, z.string().regex(/^[a-f0-9]{64}$/i).optional()),
  GMAIL_CLIENT_ID: z.preprocess(optionalValue, z.string().min(1).optional()),
  GMAIL_CLIENT_SECRET: z.preprocess(optionalValue, z.string().min(1).optional()),
  GMAIL_USER: z.preprocess(optionalValue, z.string().email().optional()),
  EMAIL_MAX_PER_DAY: z.coerce.number().int().min(1).max(500).default(100)
});

export function parseEnvironment(values: Record<string, unknown>) {
  const core = coreSchema.parse(values);
  const email = emailSchema.safeParse(values);
  // Reject the whole optional integration without preventing the task app from starting.
  return {
    env: { ...core, ...(email.success ? email.data : emailSchema.parse({})) },
    invalidEmailFields: email.success ? [] : [...new Set(email.error.issues.map((issue) => String(issue.path[0])))]
  };
}
