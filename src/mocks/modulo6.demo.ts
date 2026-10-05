import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { tripSchema } from '../direcciones/domain';
import { connect,publish,EXCHANGE } from '../messaging/broker';
const app=express();app.use(express.json({limit:'32kb'}));
const trips=new Map<string,any>();
const puntosDemo={origen:{direccion:'Plaza 25 de Mayo, Resistencia',latitud:-27.4513,longitud:-58.9866},destino:{direccion:'Terminal de Ómnibus, Resistencia',latitud:-27.4767,longitud:-59.0112}};
trips.set('viaje-completado-1',{id:'viaje-completado-1',clienteId:'cliente-123',conductorId:'conductor-789',estado:'COMPLETADO',origen:puntosDemo.origen.direccion,destino:puntosDemo.destino.direccion,fechaCreacion:'2026-10-05T14:00:00.000Z'});
trips.set('viaje-en-curso-2',{id:'viaje-en-curso-2',clienteId:'cliente-123',conductorId:'conductor-789',estado:'en curso'});
app.get('/health',(_req,res)=>res.json({status:'ok',simulado:true}));
app.use((req,res,next)=>{
 if(!process.env.INTEGRATION_SECRET||req.get('x-service-key')!==process.env.INTEGRATION_SECRET) return res.status(401).json({code:'UNAUTHORIZED'});
 next();
});
app.get('/api/viajes/:id',(req,res)=>{
 const trip=trips.get(req.params.id);return trip?res.json(trip):res.status(404).json({code:'TRIP_NOT_FOUND'});
});
// Simulador explícito del productor M6, no endpoint de negocio de M2.
app.post('/demo/viajes/completados',async(req,res)=>{
 const parsed=tripSchema.safeParse({...req.body,type:'TripCompleted.v1',eventId:req.body.eventId??randomUUID(),occurredAt:req.body.occurredAt??new Date().toISOString(),correlationId:req.body.correlationId??randomUUID()});
 if(!parsed.success) return res.status(400).json({code:'VALIDATION_ERROR'});
 let broker:Awaited<ReturnType<typeof connect>>|undefined;
 try {
  broker=await connect();
  await publish(broker.channel,EXCHANGE,'TripCompleted.v1',Buffer.from(JSON.stringify(parsed.data)),{messageId:parsed.data.eventId});
  trips.set(parsed.data.data.viajeId,{id:parsed.data.data.viajeId,clienteId:parsed.data.data.clienteId,conductorId:'conductor-demo',estado:'completado',origen:parsed.data.data.origen,destino:parsed.data.data.destino,completadoAt:parsed.data.occurredAt});
  return res.status(202).json({data:parsed.data});
 } catch {return res.status(503).json({code:'BROKER_UNAVAILABLE'});}
 finally {await broker?.connection.close().catch(()=>{});}
});
app.listen(Number(process.env.PORT??4000));
