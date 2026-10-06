import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { importarViaje } from './importar-viaje';
import { identifier } from './domain';
import { prisma } from '../config/prisma';
import { redisClient } from '../config/redis';
import { ApiError, createSchema, expectedVersion, patchSchema, pointSchema } from './domain';
import { DireccionesService } from './service';
export const addresses=new DireccionesService(prisma,redisClient);
export const router=Router();
const wrap=(fn:(req:Request,res:Response)=>Promise<any>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
const idem=(req:Request)=>{
  const key=req.get('Idempotency-Key');
  if(!key||!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new ApiError(400,'IDEMPOTENCY_REQUIRED','Enviar Idempotency-Key de 8 a 100 caracteres alfanuméricos, guion o guion bajo');
  return key;
};
router.get('/geocodificacion',wrap(async(req,res)=>{
  const q=z.string().trim().min(3).max(200).parse(req.query.q);
  try {
    const result=await axios.get(`${process.env.M4_BASE_URL}/api/v1/geocodificacion`,{params:{q},timeout:2000,headers:{'x-correlation-id':res.locals.correlationId,'x-service-key':process.env.INTEGRATION_SECRET}});
    return res.json({data:z.array(pointSchema).parse(result.data.data)});
  } catch { throw new ApiError(503,'MAPS_UNAVAILABLE','No se pudo consultar el servicio de mapas'); }
}));
router.get('/direcciones',wrap(async(req,res)=>{
  const query=z.object({tipo:z.enum(['ORIGEN','DESTINO']).optional(),favorita:z.enum(['true','false']).optional(),recientes:z.literal('true').optional(),page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict().parse(req.query);
  const result=await addresses.list(res.locals.clienteId,{tipo:query.tipo,favorita:query.favorita===undefined?undefined:query.favorita==='true',recientes:query.recientes==='true'});
  res.set('X-Cache',result.cache);
  return res.json({data:result.data.slice((query.page-1)*query.limit,query.page*query.limit),total:result.data.length,page:query.page,limit:query.limit});
}));
router.post('/direcciones/desde-viaje',wrap(async(req,res)=>{
  const {viajeId}=z.object({viajeId:identifier}).strict().parse(req.body);
  return res.json({data:await importarViaje(viajeId,res.locals.clienteId,res.locals.correlationId,addresses)});
}));
router.get('/direcciones/sugerencias',wrap(async(_req,res)=>{
  const result=await addresses.suggestions(res.locals.clienteId);
  return res.set('X-Cache',result.cache).json({data:result.data});
}));
router.get('/direcciones/:id',wrap(async(req,res)=>{
  const row=await addresses.get(res.locals.clienteId,z.string().uuid().parse(req.params.id));
  return res.set('ETag',`"${row.version}"`).json({data:row});
}));
router.post('/direcciones',wrap(async(req,res)=>{
  const r=await addresses.mutate(res.locals.clienteId,'CREATE',idem(req),createSchema.parse(req.body),res.locals.correlationId);
  res.set('Idempotency-Replayed',String(r.replayed));
  res.set('Location',`/api/v1/direcciones/${(r.data as any).id}`).set('ETag',`"${(r.data as any).version}"`);
  return res.status(r.status).json({data:r.data});
}));
for(const method of ['patch','delete'] as const) router[method]('/direcciones/:id',wrap(async(req,res)=>{
  const payload={id:z.string().uuid().parse(req.params.id),version:expectedVersion(req.get('If-Match')),...(method==='patch'?{changes:patchSchema.parse(req.body)}:{})};
  const r=await addresses.mutate(res.locals.clienteId,method==='patch'?'PATCH':'DELETE',idem(req),payload,res.locals.correlationId);
  res.set('Idempotency-Replayed',String(r.replayed));
  if(method==='patch') res.set('ETag',`"${(r.data as any).version}"`);
  return res.status(r.status).json({data:r.data});
}));
