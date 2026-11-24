import { z } from 'zod';
export const clientIdentity = z.union([
  z.string().uuid(),
  z
    .string()
    .max(128)
    .regex(/^[1-9]\d*$/),
]);
