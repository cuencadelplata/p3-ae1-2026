import { z } from 'zod';

export const createCalificacionSchema = z.object({
  viajeId: z
    .string({ required_error: 'El viajeId es requerido' })
    .min(1, 'El viajeId no puede estar vacío'),
  puntuacion: z
    .number({ required_error: 'La puntuación es requerida' })
    .int('La puntuación debe ser un número entero')
    .min(1, 'La puntuación mínima es 1 estrella')
    .max(5, 'La puntuación máxima es 5 estrellas'),
  comentario: z
    .string()
    .max(500, 'El comentario no puede superar los 500 caracteres')
    .optional(),
});

export type CreateCalificacionInput = z.infer<typeof createCalificacionSchema>;
