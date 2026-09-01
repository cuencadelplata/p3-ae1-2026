import 'dotenv/config';

import { z } from 'zod';

const urlWithDefault = (defaultValue: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().default(defaultValue),
  );

const stringWithDefault = (defaultValue: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).default(defaultValue),
  );

const supabaseUrlSchema = z
  .string()
  .url('SUPABASE_URL debe ser una URL válida.')
  .refine((value) => !value.includes('your-project-ref'), {
    message: 'SUPABASE_URL todavía contiene el placeholder de ejemplo.',
  });

const supabaseKeySchema = z
  .string()
  .min(1, 'SUPABASE_KEY es obligatoria.')
  .refine((value) => !value.toLowerCase().startsWith('replace-with'), {
    message: 'SUPABASE_KEY todavía contiene el placeholder de ejemplo.',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  SUPABASE_URL: supabaseUrlSchema,
  SUPABASE_KEY: supabaseKeySchema,
  M5_URL: urlWithDefault('http://localhost:3001'),
  M7_URL: urlWithDefault('http://localhost:3002'),
  RESERVATION_JOB_INTERVAL: stringWithDefault('*/30 * * * * *'),
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
