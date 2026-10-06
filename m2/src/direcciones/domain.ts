import { createHash } from 'node:crypto';
import { z } from 'zod';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const pointFields = z.object({
  direccion: z.string().trim().min(3).max(250),
  latitud: z.number().finite().min(-90).max(90).nullable().optional(),
  longitud: z.number().finite().min(-180).max(180).nullable().optional(),
}).strict();
const pairedCoordinates = (p: {latitud?:number|null;longitud?:number|null}) =>
  (p.latitud == null) === (p.longitud == null);
export const pointSchema = pointFields.refine(pairedCoordinates, 'Indicar ambas coordenadas o ninguna');
export type Point = z.infer<typeof pointSchema>;
export const createSchema = pointFields.extend({
  tipo: z.enum(['ORIGEN', 'DESTINO']),
  etiqueta: z.string().trim().min(1).max(60).optional(),
}).strict().refine(pairedCoordinates, 'Indicar ambas coordenadas o ninguna');
export const patchSchema = z.object({
  etiqueta: z.string().trim().min(1).max(60).optional(),
  favorita: z.boolean().optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'Debe indicar etiqueta o favorita');
export const tripSchema = z.object({
  eventId: z.string().uuid(), type: z.literal('TripCompleted.v1'),
  occurredAt: z.string().datetime(), correlationId: identifier,
  data: z.object({ viajeId: identifier, clienteId: identifier,
    origen: pointSchema, destino: pointSchema }).strict(),
}).strict();
export const favoriteEventSchema = z.object({
  eventId: z.string().uuid(), type: z.literal('FavoriteAddressChanged.v1'),
  occurredAt: z.string().datetime(), correlationId: identifier,
  data: z.object({ clienteId: identifier, direccionId: z.string().uuid(),
    accion: z.enum(['CREADA','ACTUALIZADA','ELIMINADA']), version: z.number().int().positive() }).strict(),
}).strict();
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function locationKey(p: {direccion?:string;latitud?:number|null;longitud?:number|null}) {
  if(p.latitud != null && p.longitud != null) return `${p.latitud.toFixed(6)},${p.longitud.toFixed(6)}`;
  // No inventar coordenadas ni llamar geocoding para aceptar direcciones de M6.
  const normalized=(p.direccion??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
  if(!normalized) throw new ApiError(400,'ADDRESS_REQUIRED','Se requiere una dirección');
  return 'texto:'+hash(normalized);
}
// Orden canónico independiente del orden de propiedades JSON enviado por HTTP.
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function expectedVersion(header?: string) {
  if (!header) throw new ApiError(428, 'VERSION_REQUIRED', 'Enviar If-Match con la versión entre comillas');
  if (!/^"[1-9][0-9]*"$/.test(header)) throw new ApiError(400, 'INVALID_VERSION', 'If-Match inválido');
  const n = Number(header.slice(1,-1));
  if (!Number.isSafeInteger(n)) throw new ApiError(400, 'INVALID_VERSION', 'Versión inválida');
  return n;
}
