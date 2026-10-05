import 'dotenv/config';
import express from 'express';
import { mkdir,readFile,writeFile,rename,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { connect,consume,FAVORITES } from '../messaging/broker';
import { favoriteEventSchema } from '../direcciones/domain';
const dir=process.env.NOTIFICATIONS_DIR??'/tmp/m8-notifications';
const app=express();
let connected=false;
app.get('/health',(_req,res)=>res.status(connected?200:503).json({status:connected?'ready':'degraded',simulado:true}));
app.get('/demo/notificaciones',async(req,res)=>{
 if(!process.env.INTEGRATION_SECRET||req.get('x-service-key')!==process.env.INTEGRATION_SECRET) return res.status(401).json({code:'UNAUTHORIZED'});
 try {
  const names=(await readdir(dir)).filter(n=>n.endsWith('.json'));
  return res.json({data:await Promise.all(names.map(async n=>JSON.parse(await readFile(`${dir}/${n}`,'utf8'))))});
 }catch{return res.status(503).json({code:'STORAGE_UNAVAILABLE'});}
});
app.listen(Number(process.env.PORT??4008));
async function run(){
 await mkdir(dir,{recursive:true});
 while(true){
  let broker:Awaited<ReturnType<typeof connect>>|undefined;
  try {
   broker=await connect();const b=broker;
   const closed=new Promise<void>(resolve=>{b.connection.once('close',()=>resolve());b.channel.once('close',()=>resolve());});
   await consume(b.channel,FAVORITES,favoriteEventSchema,async event=>{
    const file=`${dir}/${event.eventId}.json`;
    try{await readFile(file);return;}catch(e:any){if(e.code!=='ENOENT')throw e;}
    // Un archivo por evento: el reemplazo atómico mantiene un único efecto visible.
    const temp=`${dir}/${event.eventId}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify({eventId:event.eventId,tipo:event.type,data:event.data,correlationId:event.correlationId}),{mode:0o600});
    await rename(temp,file);
   });
   connected=true;await closed;
  }catch {console.warn(JSON.stringify({event:'m8_reconnecting'}));}
  connected=false;await broker?.connection.close().catch(()=>{});
  await new Promise(r=>setTimeout(r,2000));
 }
}
void run();
