import { z } from 'zod';

import { AppError } from '../errors/app.error.js';
import { TIPOS_VEHICULO, type ActualizarReserva, type CrearReserva } from '../domain/reserva.js';

const ubicacionSchema = z.string().trim().min(1).max(500);
const fechaFuturaSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) > Date.now(), {
    message: 'La fecha y hora programada debe ser futura.',
  });

const validarOrigenDestino = (
  value: { origen?: string; destino?: string },
  context: z.RefinementCtx,
): void => {
  if (
    value.origen !== undefined &&
    value.destino !== undefined &&
    value.origen.localeCompare(value.destino, undefined, { sensitivity: 'accent' }) === 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['destino'],
      message: 'El origen y el destino deben ser diferentes.',
    });
  }
};

const crearReservaSchema = z
  .object({
    clienteId: z.string().uuid(),
    origen: ubicacionSchema,
    destino: ubicacionSchema,
    vehiculo: z.enum(TIPOS_VEHICULO),
    fechaHoraProgramada: fechaFuturaSchema,
  })
  .strict()
  .superRefine(validarOrigenDestino);

const actualizarReservaSchema = z
  .object({
    origen: ubicacionSchema.optional(),
    destino: ubicacionSchema.optional(),
    vehiculo: z.enum(TIPOS_VEHICULO).optional(),
    fechaHoraProgramada: fechaFuturaSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Debe indicar al menos un campo para actualizar.',
  })
  .superRefine(validarOrigenDestino);

const idSchema = z.string().uuid();

const toValidationError = (error: z.ZodError): AppError => {
  const fechaInvalida = error.issues.some((issue) => issue.path[0] === 'fechaHoraProgramada');

  return new AppError(
    400,
    fechaInvalida ? 'FECHA_INVALIDA' : 'DATOS_INVALIDOS',
    fechaInvalida
      ? 'La fecha y hora programada debe ser válida y futura.'
      : 'Los datos enviados no son válidos.',
    { cause: error },
  );
};

export const parseCrearReserva = (value: unknown): CrearReserva => {
  const result = crearReservaSchema.safeParse(value);
  if (!result.success) {
    throw toValidationError(result.error);
  }
  return result.data;
};

export const parseActualizarReserva = (value: unknown): ActualizarReserva => {
  const result = actualizarReservaSchema.safeParse(value);
  if (!result.success) {
    throw toValidationError(result.error);
  }
  return result.data;
};

export const parseReservaId = (value: unknown): string => {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'DATOS_INVALIDOS', 'El identificador de reserva no es válido.');
  }
  return result.data;
};
