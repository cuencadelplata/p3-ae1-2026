import { Prisma, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { ApiError, canonical, hash, locationKey, tripSchema, Point } from './domain';
import { z } from 'zod';
type Tx = Prisma.TransactionClient;
export class DireccionesService {
  constructor(private db: PrismaClient, private cache: Redis) {}
  private async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for(let i=0;;i++) {
      try { return await this.db.$transaction(fn,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable, maxWait:5000, timeout:10000}); }
      catch(e:any) {
        if (['P2034','P2002'].includes(e.code) && i<7) { await new Promise(r=>setTimeout(r,10*(i+1)+Math.random()*20)); continue; }
        if (['P2034','P2002'].includes(e.code)) throw new ApiError(409,'CONCURRENT_WRITE','Conflicto concurrente; reintente');
        throw e;
      }
    }
  }
  private async revision(tx:Tx, clienteId:string) {
    return tx.revisionCliente.upsert({where:{clienteId},create:{clienteId,version:1},update:{version:{increment:1}}});
  }
  private key(c:string,v:number) { return `m2:direcciones:${hash(c)}:v${v}`; }
  private async invalidate(c:string,v:number) {
    try { await this.cache.del(this.key(c,v-1)); } catch { /* Nueva versión impide leer la clave vieja aun sin Redis. */ }
  }
  private async event(tx:Tx, clienteId:string, direccionId:string, accion:string, version:number, correlationId:string) {
    const eventId=randomUUID();
    await tx.outbox.create({data:{id:eventId,tipo:'FavoriteAddressChanged.v1',correlationId,payload:{
      eventId,type:'FavoriteAddressChanged.v1',occurredAt:new Date().toISOString(),correlationId,
      data:{clienteId,direccionId,accion,version},
    }}});
  }
  async list(c:string, filter:{tipo?:string; favorita?:boolean; recientes?:boolean}) {
    // Revisión durable: evita volver a servir caché vieja si Redis falló al invalidar.
    const rev=await this.db.revisionCliente.findUnique({where:{clienteId:c}});
    const key=this.key(c,rev?.version??0);
    let rows:any[]|undefined; let source='MISS';
    try { const raw=await this.cache.get(key); if(raw){rows=JSON.parse(raw);source='HIT';} } catch {}
    if(!rows) {
      rows=await this.db.direccion.findMany({where:{clienteId:c},orderBy:[{ultimoUso:'desc'},{createdAt:'desc'},{id:'asc'}]});
      try { await this.cache.set(key,JSON.stringify(rows),'EX',Number(process.env.CACHE_TTL_SECONDS??60)); } catch {source='BYPASS';}
    }
    const data=rows.filter(d=>(!filter.tipo||d.tipo===filter.tipo) && (filter.favorita===undefined||d.favorita===filter.favorita) && (!filter.recientes||d.usos>0));
    return {data,cache:source};
  }
  async get(c:string,id:string) {
    const row=await this.db.direccion.findFirst({where:{id,clienteId:c}});
    if(!row) throw new ApiError(404,'NOT_FOUND','Dirección no encontrada');
    return row;
  }
  async mutate(c:string, operation:string, key:string, payload:any, correlation:string) {
    const idem=hash(`${c}:${operation}:${key}`), fingerprint=hash(canonical(payload));
    const result=await this.transaction(async tx=>{
      const previous=await tx.idempotencia.findUnique({where:{id:idem}});
      if(previous) {
        if(previous.hash!==fingerprint) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','La clave fue usada con otros datos');
        return {status:previous.estado,data:previous.respuesta,replayed:true,revision:0};
      }
      let row:any; let status=200;
      if(operation==='CREATE') {
        const {tipo,etiqueta,direccion,latitud,longitud}=payload;
        const clave=locationKey(payload);
        const previousAddress=await tx.direccion.findUnique({where:{clienteId_tipo_clave:{clienteId:c,tipo,clave}}});
        if(previousAddress?.favorita) throw new ApiError(409,'DUPLICATE_ADDRESS','Esta dirección ya es favorita para ese uso');
        row=previousAddress
          ? await tx.direccion.update({where:{id:previousAddress.id},data:{favorita:true,etiqueta,direccion,version:{increment:1}}})
          : await tx.direccion.create({data:{clienteId:c,tipo,clave,etiqueta,direccion,latitud,longitud,favorita:true}});
        status=201;
        await this.event(tx,c,row.id,'CREADA',row.version,correlation);
      } else {
        const current=await tx.direccion.findFirst({where:{id:payload.id,clienteId:c}});
        if(!current) throw new ApiError(404,'NOT_FOUND','Dirección no encontrada');
        if(current.version!==payload.version) throw new ApiError(412,'VERSION_CONFLICT','La dirección cambió; vuelva a consultarla');
        if(operation==='DELETE') {
          await tx.direccion.delete({where:{id:current.id}});
          await tx.viajeReciente.deleteMany({where:{clienteId:c,OR:[{origen:{path:['direccion'],equals:current.direccion}},{destino:{path:['direccion'],equals:current.direccion}}]}});
          row={id:current.id,eliminada:true};
          await this.event(tx,c,current.id,'ELIMINADA',current.version+1,correlation);
        } else {
          row=await tx.direccion.update({where:{id:current.id},data:{...payload.changes,version:{increment:1}}});
          await this.event(tx,c,row.id,'ACTUALIZADA',row.version,correlation);
        }
      }
      const revision=await this.revision(tx,c);
      const data=JSON.parse(JSON.stringify(row));
      await tx.idempotencia.create({data:{id:idem,hash:fingerprint,respuesta:data,estado:status}});
      return {status,data,replayed:false,revision:revision.version};
    });
    if(result.revision) await this.invalidate(c,result.revision);
    return result;
  }

  async suggestions(c:string) {
    const {data,cache}=await this.list(c,{});
    const last=await this.db.viajeReciente.findFirst({where:{clienteId:c},orderBy:[{fechaViaje:'desc'},{viajeId:'asc'}]});
    const candidates=new Map<string,any>();
    const sorted=data.filter(d=>d.favorita||d.usos>0).sort((a,b)=>
      (Date.parse(b.ultimoUso??'')||0)-(Date.parse(a.ultimoUso??'')||0) || Number(b.favorita)-Number(a.favorita) || b.usos-a.usos || a.id.localeCompare(b.id));
    for(const d of sorted) {
      const k=locationKey(d);
      const old=candidates.get(k);
      if(old) {old.favorita ||= d.favorita; continue;}
      candidates.set(k,{id:d.id,direccion:d.direccion,latitud:d.latitud,longitud:d.longitud,favorita:d.favorita,ultimoUso:d.ultimoUso});
    }
    const prioritize=(point:Point|undefined)=>{
      const items=[...candidates.values()];
      if(!point)return items;
      const key=locationKey(point);
      const at=items.findIndex(d=>locationKey(d)===key);
      if(at>0)items.unshift(...items.splice(at,1));
      return items;
    };
    // Los tipos ORIGEN/DESTINO describen el uso histórico, no limitan el próximo viaje.
    const origen=last?.destino as Point|undefined, destino=last?.origen as Point|undefined;
    return {cache,data:{
      origenes:prioritize(origen),destinos:prioritize(destino),
      regreso:last?{viajeId:last.viajeId,origen,destino,fechaReferencia:last.fechaReferencia,fechaViaje:last.fechaViaje,requiereConfirmacion:true}:null,
    }};
  }
  async recordTrip(event:z.infer<typeof tripSchema>) {
    return this.recordJourney({...event.data,eventId:event.eventId,fechaViaje:new Date(event.occurredAt),fechaReferencia:'FINALIZACION'});
  }
  async recordJourney(input:{viajeId:string;clienteId:string;origen:Point;destino:Point;fechaViaje:Date;fechaReferencia:string;eventId?:string}) {
    const result=await this.transaction(async tx=>{
      if(input.eventId) {
        if(await tx.inbox.findUnique({where:{id:input.eventId}})) return null;
        await tx.inbox.create({data:{id:input.eventId}});
      }
      const c=input.clienteId;
      const snapshot=await tx.viajeReciente.findUnique({where:{viajeId:input.viajeId}});
      if(snapshot && snapshot.clienteId!==c) throw new ApiError(409,'TRIP_OWNER_CONFLICT','El viaje fue registrado con otro propietario');
      const processed=await tx.viajeProcesado.findUnique({where:{viajeId:input.viajeId}});
      // REST + RabbitMQ comparten la misma identidad de negocio.
      if(processed) {
        if(snapshot && snapshot.fechaReferencia!=='FINALIZACION' && input.fechaReferencia==='FINALIZACION') {
          await tx.viajeReciente.update({where:{viajeId:input.viajeId},data:{fechaViaje:input.fechaViaje,fechaReferencia:input.fechaReferencia}});
          for(const [tipo,point] of [['ORIGEN',input.origen],['DESTINO',input.destino]] as const)
            await tx.direccion.updateMany({where:{clienteId:c,tipo,clave:locationKey(point),OR:[{ultimoUso:null},{ultimoUso:{lt:input.fechaViaje}}]},data:{ultimoUso:input.fechaViaje,version:{increment:1}}});
          return this.revision(tx,c);
        }
        return null;
      }
      await tx.viajeProcesado.create({data:{viajeId:input.viajeId}});
      const clean=(p:Point)=>({direccion:p.direccion,latitud:p.latitud??null,longitud:p.longitud??null});
      await tx.viajeReciente.create({data:{viajeId:input.viajeId,clienteId:c,origen:clean(input.origen),destino:clean(input.destino),fechaViaje:input.fechaViaje,fechaReferencia:input.fechaReferencia}});
      const when=input.fechaViaje;
      for(const [tipo,point] of [['ORIGEN',input.origen],['DESTINO',input.destino]] as const) {
        const clave=locationKey(point);
        const old=await tx.direccion.findUnique({where:{clienteId_tipo_clave:{clienteId:c,tipo,clave}}});
        if(old) await tx.direccion.update({where:{id:old.id},data:{usos:{increment:1},ultimoUso:!old.ultimoUso||old.ultimoUso<when?when:old.ultimoUso,version:{increment:1}}});
        else await tx.direccion.create({data:{clienteId:c,tipo,clave,...clean(point),usos:1,ultimoUso:when}});
      }
      const stale=await tx.direccion.findMany({where:{clienteId:c,favorita:false},orderBy:[{ultimoUso:'desc'},{id:'asc'}],skip:20,select:{id:true}});
      if(stale.length) await tx.direccion.deleteMany({where:{id:{in:stale.map(d=>d.id)}}});
      const oldTrips=await tx.viajeReciente.findMany({where:{clienteId:c},orderBy:[{fechaViaje:'desc'},{viajeId:'asc'}],skip:20,select:{viajeId:true}});
      if(oldTrips.length)await tx.viajeReciente.deleteMany({where:{viajeId:{in:oldTrips.map(t=>t.viajeId)}}});
      return this.revision(tx,c);
    });
    if(result) await this.invalidate(input.clienteId,result.version);
  }
}
