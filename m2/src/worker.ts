import 'dotenv/config';
import { createServer } from 'node:http';
import { prisma } from './config/prisma';
import { redisClient } from './config/redis';
import { DireccionesService } from './direcciones/service';
import { tripEventSchema } from './direcciones/domain';
import { sincronizarViajeCompletado } from './direcciones/importar-viaje';
import { connect, consume, publish, EXCHANGE, TRIPS } from './messaging/broker';
import { logger } from './observability/logging';
import { metricsRegistry, recordOutboxPublicado, registerOutboxPendientes } from './observability/metrics';
const service=new DireccionesService(prisma,redisClient);
// El worker no tiene API HTTP: expone solo /metrics para que Alloy lo lea (instance="worker").
registerOutboxPendientes(()=>prisma.outbox.count({where:{publicadoAt:null}}));
const metricsServer=createServer((req,res)=>{
  if(req.method!=='GET'||req.url!=='/metrics'){res.writeHead(404).end();return;}
  metricsRegistry.metrics()
    .then(body=>{res.writeHead(200,{'Content-Type':metricsRegistry.contentType}).end(body);})
    .catch(()=>{res.writeHead(500).end();});
});
metricsServer.listen(Number(process.env.WORKER_METRICS_PORT??9464));
let stopping=false; let current:Awaited<ReturnType<typeof connect>>|undefined;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function run() {
  while(!stopping) {
    try {
      const broker=await connect(); current=broker; let closed=false;
      broker.connection.once('close',()=>{closed=true;});
      broker.channel.once('close',()=>{closed=true;});
      // TripCompleted.v1 trae las direcciones; el trip.completed de M6 no, y se piden a M6.
      await consume(broker.channel,TRIPS,tripEventSchema,event=>{
        if(event.source==='m6') return sincronizarViajeCompletado(event,service);
        const {source:_source,...trip}=event;
        return service.recordTrip(trip);
      });
      while(!stopping&&!closed) {
        // Publicar después del commit; un crash antes de marcado causa redelivery seguro.
        const rows=await prisma.outbox.findMany({where:{publicadoAt:null},orderBy:{createdAt:'asc'},take:50});
        for(const row of rows) {
          await publish(broker.channel,EXCHANGE,row.tipo,Buffer.from(JSON.stringify(row.payload)),{messageId:row.id,correlationId:row.correlationId});
          await prisma.outbox.update({where:{id:row.id},data:{publicadoAt:new Date()}});
          recordOutboxPublicado(row.tipo,row.createdAt);
          logger.info({event:'outbox_published',type:row.tipo,eventId:row.id,correlationId:row.correlationId},'outbox_published');
        }
        await redisClient.set('m2:worker:heartbeat',new Date().toISOString(),'EX',10).catch(()=>{});
        await pause(500);
      }
    } catch (err) { logger.warn({event:'worker_reconnecting',err},'worker_reconnecting'); }
    if(current) await current.connection.close().catch(()=>{});
    if(!stopping) await pause(2000);
  }
  metricsServer.close();redisClient.disconnect();await prisma.$disconnect();
}
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{stopping=true;void current?.connection.close().catch(()=>{});});
void run();
