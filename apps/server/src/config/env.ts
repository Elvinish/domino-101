import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    WEB_ORIGIN: z
      .url()
      .refine(
        (value) =>
          URL.canParse(value) &&
          ['http:', 'https:'].includes(new URL(value).protocol) &&
          new URL(value).origin === value,
      )
      .default('http://localhost:5173'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    PERSISTENCE_MODE: z.enum(['memory', 'postgres']).default('memory'),
    DATABASE_URL: z
      .string()
      .trim()
      .url()
      .refine((value) => {
        try {
          return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.PERSISTENCE_MODE === 'postgres' && !value.DATABASE_URL)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when PERSISTENCE_MODE=postgres',
      });
    if (value.NODE_ENV === 'production' && value.PERSISTENCE_MODE === 'memory')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PERSISTENCE_MODE'],
        message: 'PERSISTENCE_MODE=postgres is required in production',
      });
  });
export type ServerEnv = z.infer<typeof envSchema>;

export function parseServerEnv(input: Record<string, unknown>): ServerEnv {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    // Report field names only; environment values may contain secrets.
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Invalid server environment: ${fields.join(', ')}`);
  }
  return result.data;
}
