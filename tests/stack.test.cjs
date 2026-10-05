require('dotenv/config');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHmac}=require('node:crypto');
const amqp=require('amqplib');
const secret=process.env.AUTH_SECRET;
const c='stack-'+randomUUID();
function token(){const p=Buffer.from(JSON.stringify({sub:c,role:'Cliente',aud:'m2',exp:Math.floor(Date.now()/1000)+600})).toString('base64url');return p+'.'+createHmac('sha256',secret).update(p).digest('base64url');}
async function waitFor(fn){for(let i=0;i<60;i++){if(await fn())return;await new Promise(r=>setTimeout(r,500));}assert.fail('El efecto asíncrono no apareció en 30 segundos');}
const api=process.env.TEST_API_URL||'http://localhost:3000';
const m6=process.env.M6_BASE_URL||'http://localhost:4000';
const m8=process.env.M8_BASE_URL||'http://localhost:4008';
const auth=()=>({Authorization:'Bearer '+token(),'Content-Type':'application/json'});
test('Stack real: M6 → RabbitMQ → M2 y M2 → outbox → RabbitMQ → M8',async()=>{
 assert.ok(secret&&process.env.INTEGRATION_SECRET,'Ejecutar setup y cargar .env');
 const payload={eventId:randomUUID(),occurredAt:new Date().toISOString(),correlationId:randomUUID(),data:{viajeId:randomUUID(),clienteId:c,origen:{direccion:'Origen demo',latitud:-27,longitud:-58},destino:{direccion:'Destino demo',latitud:-26,longitud:-57}}};
 const send=()=>fetch(m6+'/demo/viajes/completados',{method:'POST',headers:{'Content-Type':'application/json','x-service-key':process.env.INTEGRATION_SECRET},body:JSON.stringify(payload)});
 assert.equal((await send()).status,202);
 const recent=async()=>{const r=await fetch(api+'/api/v1/direcciones?recientes=true',{headers:auth()});assert.equal(r.status,200);return (await r.json()).data;};
 await waitFor(async()=>(await recent()).length===2);
 assert.equal((await send()).status,202);
 await new Promise(r=>setTimeout(r,1500));assert.ok((await recent()).every(d=>d.usos===1));
 const favorite=await fetch(api+'/api/v1/direcciones',{method:'POST',headers:{...auth(),'Idempotency-Key':randomUUID()},body:JSON.stringify({...payload.data.origen,tipo:'ORIGEN',etiqueta:'Casa'})});
 assert.equal(favorite.status,201);const id=(await favorite.json()).data.id;
 await waitFor(async()=>{const r=await fetch(m8+'/demo/notificaciones',{headers:{'x-service-key':process.env.INTEGRATION_SECRET}});return r.ok&&(await r.json()).data.some(n=>n.data.direccionId===id);});
 const broker=await amqp.connect(process.env.RABBITMQ_URL),channel=await broker.createConfirmChannel();
 try{
  const eventId=randomUUID();
  const event={eventId,type:'FavoriteAddressChanged.v1',occurredAt:new Date().toISOString(),correlationId:randomUUID(),data:{clienteId:c,direccionId:id,accion:'ACTUALIZADA',version:2}};
  for(let i=0;i<3;i++)channel.publish('mobility.events',event.type,Buffer.from(JSON.stringify(event)),{persistent:true,messageId:eventId});
  await channel.waitForConfirms();
  await waitFor(async()=>{const r=await fetch(m8+'/demo/notificaciones',{headers:{'x-service-key':process.env.INTEGRATION_SECRET}});return (await r.json()).data.filter(n=>n.eventId===eventId).length===1;});
  const before=(await channel.checkQueue('m2.trip-completed.dlq')).messageCount;
  channel.publish('mobility.events','TripCompleted.v1',Buffer.from('{invalid-json'),{persistent:true});await channel.waitForConfirms();
  await waitFor(async()=>(await channel.checkQueue('m2.trip-completed.dlq')).messageCount>before);
 }finally{await broker.close();}
});
