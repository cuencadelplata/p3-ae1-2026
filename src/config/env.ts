import 'dotenv/config';

import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  SUPABASE_URL: z.string().url('SUPABASE_URL debe ser una URL válida.'),
  SUPABASE_KEY: z.string().min(1, 'SUPABASE_KEY es obligatoria.'),
  M5_URL: optionalUrl,
  M7_URL: optionalUrl,
  RESERVATION_JOB_INTERVAL: optionalString,
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Configuración de entorno inválida: ${details}`);
}

export const env = Object.freeze(parsedEnv.data);
export type Environment = z.infer<typeof envSchema>;
