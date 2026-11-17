import { z } from 'zod';
import { modulo6Client, Modulo6UnavailableError, TripNotFoundError } from '../clients/modulo6.client';
import { ApiError, identifier, pointSchema } from './domain';
import { DireccionesService } from './service';
const remotePoint=z.union([z.string().trim().min(3).max(250).transform(direccion=>({direccion,latitud:null,longitud:null})),pointSchema]);
export const tripWithAddresses=z.object({id:identifier,clienteId:identifier,estado:z.string(),
  origen:remotePoint,destino:remotePoint,
  completadoAt:z.string().datetime({offset:true}).optional(),
  fechaCreacion:z.string().datetime({offset:true}).optional(),
  createdAt:z.string().datetime({offset:true}).optional(),
});
export async function importarViaje(viajeId:string,clienteId:string,correlationId:string,service:DireccionesService) {
  let raw:any;
  try {raw=await modulo6Client.obtenerViajePorId(viajeId);}
  catch(e) {
    if(e instanceof TripNotFoundError) throw new ApiError(404,'TRIP_NOT_FOUND','Viaje no encontrado');
    if(e instanceof Modulo6UnavailableError) throw new ApiError(503,'M6_UNAVAILABLE','M6 no está accesible. Tus direcciones guardadas siguen disponibles; reintentá la importación al recuperarse.');
    throw e;
  }
  if(raw?.id!==viajeId||typeof raw?.clienteId!=='string'||typeof raw?.estado!=='string')
    throw new ApiError(502,'M6_INVALID_CONTRACT','M6 devolvió un viaje inválido');
  if(raw.clienteId!==clienteId) throw new ApiError(404,'TRIP_NOT_FOUND','Viaje no encontrado');
  // GET /api/viajes/{id} de M6 real no trae direcciones: se buscan en el historial del cliente.
  if(raw.origen==null||raw.destino==null) {
    try {raw=await modulo6Client.obtenerViajeDeCliente(clienteId,viajeId);}
    catch(e) {
      if(e instanceof TripNotFoundError) throw new ApiError(404,'TRIP_NOT_FOUND','Viaje no encontrado');
      if(e instanceof Modulo6UnavailableError) throw new ApiError(503,'M6_UNAVAILABLE','M6 no está accesible. Tus direcciones guardadas siguen disponibles; reintentá la importación al recuperarse.');
      throw e;
    }
    if(raw?.id!==viajeId||String(raw?.clienteId)!==clienteId||typeof raw?.estado!=='string')
      throw new ApiError(502,'M6_INVALID_CONTRACT','M6 devolvió un viaje inválido');
    raw={...raw,clienteId:String(raw.clienteId)};
  }
  if(raw.estado.toLowerCase()!=='completado') throw new ApiError(409,'TRIP_NOT_COMPLETED','Sólo se importan direcciones de viajes completados para sugerir el regreso');
  const parsed=tripWithAddresses.safeParse(raw);
  if(!parsed.success) throw new ApiError(502,'M6_ADDRESSES_REQUIRED','M6 debe devolver origen y destino como texto o puntos válidos');
  const trip=parsed.data;
  const fecha=trip.completadoAt??trip.fechaCreacion??trip.createdAt;
  const fechaReferencia=trip.completadoAt?'FINALIZACION':fecha?'CREACION':'IMPORTACION';
  await service.recordJourney({viajeId:trip.id,clienteId:trip.clienteId,origen:trip.origen,destino:trip.destino,
    fechaViaje:fecha?new Date(fecha):new Date(),fechaReferencia});
  return {viajeId,sincronizado:true,fechaReferencia,correlationId};
}

/**
 * Procesa el TripCompleted de M6 (routing key trip.completed). El evento no trae direcciones,
 * así que se buscan en el historial del cliente en M6. Si M6 no responde, el error hace que el
 * worker reintente el mensaje (y lo mande a la DLQ tras 3 intentos).
 * Idempotente por viajeId: un mismo viaje importado a mano o recibido dos veces cuenta una sola vez.
 */
export async function sincronizarViajeCompletado(
  event:{viajeId:string;clienteId:string;occurredAt:string;eventId:string},
  service:Pick<DireccionesService,'recordJourney'>,
) {
  const raw:any=await modulo6Client.obtenerViajeDeCliente(event.clienteId,event.viajeId);
  if(raw?.id!==event.viajeId||String(raw?.clienteId)!==event.clienteId)
    throw new ApiError(502,'M6_INVALID_CONTRACT','M6 devolvió un viaje que no corresponde al evento');
  if(String(raw.estado).toLowerCase()!=='completado')
    throw new ApiError(409,'TRIP_NOT_COMPLETED','M6 informó el viaje como completado pero su estado es '+raw.estado);
  const parsed=tripWithAddresses.safeParse({...raw,clienteId:String(raw.clienteId)});
  if(!parsed.success) throw new ApiError(502,'M6_ADDRESSES_REQUIRED','M6 debe devolver origen y destino como texto o puntos válidos');
  await service.recordJourney({viajeId:parsed.data.id,clienteId:parsed.data.clienteId,
    origen:parsed.data.origen,destino:parsed.data.destino,
    fechaViaje:new Date(event.occurredAt),fechaReferencia:'FINALIZACION',eventId:event.eventId});
}
