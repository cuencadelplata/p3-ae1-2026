require('dotenv/config');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHmac}=require('node:crypto');
const http=require('node:http');
const {spawn}=require('node:child_process');
const secret='integration-test-secret-at-least-32-characters';
process.env.AUTH_SECRET=secret;process.env.STUBS_ENABLED='true';process.env.CACHE_TTL_SECONDS='2';process.env.INTEGRATION_SECRET='integration-only';
// Identidad de M1: cada cliente de prueba es un userId numérico único (clienteId = String(userId)).
let nextUser=900000000+Math.floor(Math.random()*100000000);
const uid=()=>String(nextUser++);
const c=uid();
const otherClient=uid(),foreignClient=uid(),importClient=uid();
const point={direccion:'Plaza central de pruebas',latitud:-27.4513,longitud:-58.9866,tipo:'ORIGEN'};
const textClient=uid();
const textDate='2026-10-05T15:00:00.000Z';
let db,redis,service,server,m6,m4,base;
// JWT como el que emite M1 (stub de M1 montado en la propia app de la prueba)
const m1Secret=process.env.M1_JWT_SECRET??'m1-stub-development-secret';
const b64=(o)=>Buffer.from(JSON.stringify(o)).toString('base64url');
const token=(sub=c)=>{const iat=Math.floor(Date.now()/1000);const u=b64({alg:'HS256',typ:'JWT'})+'.'+b64({userId:Number(sub),role:'CLIENTE',iat,exp:iat+3600});return u+'.'+createHmac('sha256',m1Secret).update(u).digest('base64url');};
async function call(path,options={}){
 const r=await fetch(base+path,{...options,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json',...options.headers}});
 return {status:r.status,headers:r.headers,body:await r.json()};
}
const create=(body=point,key=randomUUID())=>call('/direcciones',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(body)});
const trip=(overrides={})=>({eventId:randomUUID(),type:'TripCompleted.v1',occurredAt:new Date().toISOString(),correlationId:randomUUID(),data:{viajeId:randomUUID(),clienteId:c,origen:{direccion:'Origen reciente',latitud:-26,longitud:-58},destino:{direccion:'Destino reciente',latitud:-25,longitud:-57}},...overrides});
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Definir DATABASE_URL de pruebas y ejecutar migraciones');
 m6=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');const id=req.url.split('/').pop();
  if(id.startsWith('texto-')){res.end(JSON.stringify({id,clienteId:textClient,conductorId:'driver',estado:'COMPLETADO',origen:'Calle Principal 100',destino:'Centro Comercial',fechaCreacion:textDate}));return;}
  if(id.includes('missing')){res.writeHead(404);res.end('{}');return;}
  res.end(JSON.stringify({id,clienteId:id.includes('foreign')?foreignClient:id.startsWith('import-')?importClient:c,conductorId:'driver',estado:id.includes('active')?'en curso':'completado',...(id.includes('legacy')?{}:{origen:{direccion:'Origen importado',latitud:-17,longitud:-55},destino:{direccion:'Destino importado',latitud:-16,longitud:-54},completadoAt:'2026-10-05T15:00:00.000Z'})}));
 });
 await new Promise(r=>m6.listen(0,'127.0.0.1',r));process.env.M6_BASE_URL=`http://127.0.0.1:${m6.address().port}`;
 const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 process.env.M4_BASE_URL=`http://127.0.0.1:${port}`;
 m4=spawn(process.execPath,['dist/mocks/modulo4.mock.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
 for(let i=0;i<50;i++){try{if((await fetch(process.env.M4_BASE_URL+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 ({prisma:db}=require('../dist/config/prisma'));({redisClient:redis}=require('../dist/config/redis'));
 await db.$connect();if(redis.status!=='ready')await new Promise((resolve,reject)=>{redis.once('ready',resolve);redis.once('error',reject);});
 const {DireccionesService}=require('../dist/direcciones/service');service=new DireccionesService(db,redis);
 const {app}=require('../dist/app');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api/v1`;
 process.env.M1_SERVICE_URL=`http://127.0.0.1:${server.address().port}/__stubs/m1`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(m6)await new Promise(r=>m6.close(r));m4?.kill();redis?.disconnect();require('../dist/config/redis').disconnectRedis();await db?.$disconnect();});
test('HTTP exige identidad y valida payload',async()=>{
 assert.equal((await call('/direcciones',{headers:{Authorization:''}})).status,401);
 assert.equal((await create({...point,latitud:100})).status,400);
 assert.equal((await create({...point,clienteId:'another'})).status,400);
});
test('20 altas concurrentes con misma clave: un registro, un evento, misma respuesta',async()=>{
 const key=randomUUID(),results=await Promise.all(Array.from({length:20},()=>create(point,key)));
 assert.deepEqual([...new Set(results.map(r=>r.status))],[201]);
 assert.equal(new Set(results.map(r=>r.body.data.id)).size,1);
 assert.equal(await db.direccion.count({where:{clienteId:c,tipo:'ORIGEN',favorita:true}}),1);
 assert.equal(await db.outbox.count({where:{payload:{path:['data','clienteId'],equals:c}}}),1);
 assert.equal((await create({...point,etiqueta:'otro'},key)).status,409);
});
test('Claves distintas tampoco duplican un favorito concurrente',async()=>{
 const results=await Promise.all(Array.from({length:10},()=>create({...point,latitud:-24})));
 assert.equal(results.filter(r=>r.status===201).length,1);
 assert.equal(results.filter(r=>r.status===409).length,9);
});
test('Aislamiento de propietario y header falsificado',async()=>{
 const item=(await create({...point,latitud:-23})).body.data;
 const other=await call(`/direcciones/${item.id}`,{headers:{Authorization:'Bearer '+token(otherClient),'x-cliente-id':c}});
 assert.equal(other.status,404);
 assert.equal((await call('/direcciones',{headers:{Authorization:'Bearer '+token(otherClient)}})).body.total,0);
});
test('Ediciones concurrentes con If-Match: una gana y otra recibe 412',async()=>{
 const item=(await create({...point,latitud:-22})).body.data;
 const results=await Promise.all(['Casa','Trabajo'].map(etiqueta=>call(`/direcciones/${item.id}`,{method:'PATCH',headers:{'Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({etiqueta})})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,412]);
 assert.equal((await call(`/direcciones/${item.id}`,{method:'PATCH',headers:{'Idempotency-Key':randomUUID()},body:'{"favorita":false}'})).status,428);
});
test('Cache real: MISS/HIT, TTL y edición invalida versión',async()=>{
 await new Promise(r=>setTimeout(r,2100));
 assert.equal((await call('/direcciones')).headers.get('x-cache'),'MISS');
 assert.equal((await call('/direcciones')).headers.get('x-cache'),'HIT');
 const item=(await create({...point,latitud:-21})).body.data;
 assert.equal((await call('/direcciones')).headers.get('x-cache'),'MISS');
 assert.ok((await call('/direcciones')).body.data.some(d=>d.id===item.id));
 const {hash}=require('../dist/direcciones/domain');const rev=await db.revisionCliente.findUnique({where:{clienteId:c}});
 const ttl=await redis.ttl(`m2:direcciones:${hash(c)}:v${rev.version}`);assert.ok(ttl>0&&ttl<=2);
 await new Promise(r=>setTimeout(r,2100));assert.equal((await call('/direcciones')).headers.get('x-cache'),'MISS');
});
test('Evento repetido incluso con ID nuevo no incrementa dos veces usos',async()=>{
 const e=trip();await Promise.all(Array.from({length:12},()=>service.recordTrip(e)));
 await service.recordTrip({...e,eventId:randomUUID()});
 const rows=await db.direccion.findMany({where:{clienteId:c,usos:{gt:0}}});assert.equal(rows.length,2);assert.ok(rows.every(r=>r.usos===1));
});
test('Eventos fuera de orden conservan ultimoUso más reciente',async()=>{
 const newest=trip({occurredAt:'2026-10-05T12:00:00.000Z'});await service.recordTrip(newest);
 const older=trip({occurredAt:'2026-10-01T12:00:00.000Z'});await service.recordTrip(older);
 const row=await db.direccion.findFirst({where:{clienteId:c,latitud:-26}});
 // Puede existir un evento de hoy previo; nunca retrocede al día 1.
 assert.ok(row.ultimoUso>=new Date(newest.occurredAt));
});
test('Promover reciente a favorita conserva su identidad y usos',async()=>{
 const row=await db.direccion.findFirst({where:{clienteId:c,latitud:-26}});
 const r=await create({direccion:row.direccion,latitud:row.latitud,longitud:row.longitud,tipo:row.tipo,etiqueta:'Frecuente'});
 assert.equal(r.status,201);assert.equal(r.body.data.id,row.id);assert.equal(r.body.data.usos,row.usos);
});
test('Eliminación repetida usa respuesta almacenada',async()=>{
 const item=(await create({...point,latitud:-20})).body.data,key=randomUUID();
 const opts={method:'DELETE',headers:{'Idempotency-Key':key,'If-Match':'"1"'}};
 assert.equal((await call(`/direcciones/${item.id}`,opts)).status,200);
 assert.equal((await call(`/direcciones/${item.id}`,opts)).headers.get('idempotency-replayed'),'true');
 assert.equal((await call(`/direcciones/${item.id}`)).status,404);
});
test('Redis caído no rompe persistencia ni devuelve caché vieja al recuperarse',async()=>{
 const {DireccionesService}=require('../dist/direcciones/service');
 const down={get:async()=>{throw Error();},set:async()=>{throw Error();},del:async()=>{throw Error();}};
 const degraded=new DireccionesService(db,down);
 await service.list(c,{});
 const r=await degraded.mutate(c,'CREATE',randomUUID(),{...point,latitud:-19},randomUUID());assert.equal(r.status,201);
 assert.equal((await degraded.list(c,{})).cache,'BYPASS');
 assert.ok((await service.list(c,{})).data.some(d=>d.id===r.data.id));
});
test('Mapa simulado por HTTP devuelve resultados y timeout/error controlado',async()=>{
 const good=await call('/geocodificacion?q=Plaza');assert.equal(good.status,200);assert.equal(good.body.data[0].direccion,'Plaza 25 de Mayo, Resistencia');
 const saved=process.env.M4_BASE_URL;process.env.M4_BASE_URL='http://127.0.0.1:1';
 assert.equal((await call('/geocodificacion?q=Plaza')).status,503);process.env.M4_BASE_URL=saved;
});
test('Regresión RF-2.4: completado, duplicado, viaje activo, lectura ajena',async()=>{
 const id=randomUUID();const opts={method:'POST',body:JSON.stringify({viajeId:id,puntuacion:5,comentario:'Prueba'})};
 assert.equal((await call('/calificaciones',opts)).status,201);
 assert.equal((await call('/calificaciones',opts)).status,409);
 assert.equal((await call('/calificaciones/viaje/'+id)).status,200);
 assert.equal((await call('/calificaciones/viaje/'+id,{headers:{Authorization:'Bearer '+token(foreignClient)}})).status,404);
 assert.equal((await call('/calificaciones',{method:'POST',body:JSON.stringify({viajeId:'active-'+randomUUID(),puntuacion:4})})).status,400);
});
test('Retención: 20 recientes no favoritas y favoritos preservados',async()=>{
 for(let i=0;i<13;i++){
  const e=trip();e.data.origen.latitud=10+i;e.data.destino.latitud=40+i;await service.recordTrip(e);
 }
 assert.equal(await db.direccion.count({where:{clienteId:c,favorita:false}}),20);
 assert.ok(await db.direccion.findFirst({where:{clienteId:c,latitud:-26,favorita:true}}));
});

test('Fallo antes del outbox revierte dirección e idempotencia en la misma transacción',async()=>{
 const {DireccionesService}=require('../dist/direcciones/service');
 const broken={$transaction:(fn,options)=>db.$transaction(tx=>fn(new Proxy(tx,{get(target,prop){if(prop==='outbox')return {create:async()=>{throw Error('fallo outbox simulado');}};return target[prop];}})),options)};
 const failing=new DireccionesService(broken,redis);
 await assert.rejects(()=>failing.mutate(c,'CREATE',randomUUID(),{...point,latitud:-18},randomUUID()),/fallo outbox/);
 assert.equal(await db.direccion.count({where:{clienteId:c,latitud:-18}}),0);
});

test('RF-2.2 consulta GET M6 y REST + evento comparten deduplicación',async()=>{
 const client=importClient;const viajeId='import-'+randomUUID();const opts={method:'POST',headers:{Authorization:'Bearer '+token(client)},body:JSON.stringify({viajeId})};
 assert.equal((await call('/direcciones/desde-viaje',opts)).status,200);
 assert.equal((await call('/direcciones/desde-viaje',opts)).status,200);
 await service.recordTrip({eventId:randomUUID(),type:'TripCompleted.v1',occurredAt:'2026-10-05T15:00:00.000Z',correlationId:randomUUID(),data:{viajeId,clienteId:client,origen:{direccion:'Origen importado',latitud:-17,longitud:-55},destino:{direccion:'Destino importado',latitud:-16,longitud:-54}}});
 const row=await db.direccion.findFirst({where:{clienteId:client,latitud:-17}});assert.equal(row.usos,1);
});
test('M6: exige viaje propio, completado y contrato con direcciones',async()=>{
 for(const [prefix,status] of [['foreign',404],['active',409],['missing',404],['legacy',502]]){
  const r=await call('/direcciones/desde-viaje',{method:'POST',body:JSON.stringify({viajeId:prefix+'-'+randomUUID()})});assert.equal(r.status,status,JSON.stringify(r.body));
 }
});

test('Contrato textual M6: origen B y destino A para regresar, sin calificar',async()=>{
 const headers={Authorization:'Bearer '+token(textClient)};
 const viajeId='texto-'+randomUUID();
 const opts={method:'POST',headers,body:JSON.stringify({viajeId})};
 const imported=await call('/direcciones/desde-viaje',opts);assert.equal(imported.status,200);assert.equal(imported.body.data.fechaReferencia,'CREACION');
 assert.equal((await call('/direcciones/desde-viaje',opts)).status,200);
 const suggestions=await call('/direcciones/sugerencias',{headers});assert.equal(suggestions.status,200);
 const data=suggestions.body.data;
 assert.equal(data.regreso.origen.direccion,'Centro Comercial');
 assert.equal(data.regreso.destino.direccion,'Calle Principal 100');
 assert.equal(data.origenes[0].direccion,'Centro Comercial');
 assert.equal(data.destinos[0].direccion,'Calle Principal 100');
 assert.equal(data.regreso.origen.latitud,null);assert.equal(data.regreso.requiereConfirmacion,true);
 assert.equal(await db.calificacion.count({where:{clienteId:textClient}}),0);
 assert.ok((await db.direccion.findMany({where:{clienteId:textClient}})).every(d=>d.usos===1));
 // Mismo viaje por RabbitMQ no duplica; puede aportar fecha de finalización conocida.
 await service.recordTrip({eventId:randomUUID(),type:'TripCompleted.v1',occurredAt:'2026-10-05T16:00:00.000Z',correlationId:randomUUID(),data:{viajeId,clienteId:textClient,origen:{direccion:'Calle Principal 100'},destino:{direccion:'Centro Comercial'}}});
 assert.ok((await db.direccion.findMany({where:{clienteId:textClient}})).every(d=>d.usos===1));
 const updated=await call('/direcciones/sugerencias',{headers});assert.equal(updated.body.data.regreso.fechaReferencia,'FINALIZACION');
});
test('Sugerencias: aislamiento, ambos usos y favoritos de texto',async()=>{
 const blank=await call('/direcciones/sugerencias',{headers:{Authorization:'Bearer '+token(uid())}});
 assert.deepEqual(blank.body.data,{origenes:[],destinos:[],regreso:null});
 const client=uid(),headers={Authorization:'Bearer '+token(client),'Idempotency-Key':randomUUID()};
 const created=await call('/direcciones',{method:'POST',headers,body:JSON.stringify({tipo:'ORIGEN',direccion:'Calle 123',etiqueta:'Casa'})});assert.equal(created.status,201);
 const data=(await call('/direcciones/sugerencias',{headers})).body.data;
 assert.equal(data.origenes[0].direccion,'Calle 123');assert.equal(data.destinos[0].direccion,'Calle 123');assert.equal(data.regreso,null);
});
test('Último viaje: eventos atrasados no sustituyen la sugerencia más reciente',async()=>{
 const client=uid();
 const record=(id,when,a,b)=>service.recordJourney({viajeId:id,clienteId:client,origen:{direccion:a},destino:{direccion:b},fechaViaje:new Date(when),fechaReferencia:'CREACION'});
 const latest=randomUUID();await record(latest,'2026-10-05T15:00:00Z','Origen nuevo','Destino nuevo');
 await record(randomUUID(),'2026-10-01T15:00:00Z','Origen viejo','Destino viejo');
 const data=(await call('/direcciones/sugerencias',{headers:{Authorization:'Bearer '+token(client)}})).body.data;
 assert.equal(data.regreso.viajeId,latest);assert.equal(data.regreso.origen.direccion,'Destino nuevo');
});
test('Eliminar dirección evita que vuelva a aparecer en la sugerencia de regreso',async()=>{
 const client=uid();
 await service.recordJourney({viajeId:randomUUID(),clienteId:client,origen:{direccion:'Origen borrado'},destino:{direccion:'Destino borrado'},fechaViaje:new Date(),fechaReferencia:'IMPORTACION'});
 const row=await db.direccion.findFirst({where:{clienteId:client,tipo:'ORIGEN'}});
 const headers={Authorization:'Bearer '+token(client),'Idempotency-Key':randomUUID(),'If-Match':`"${row.version}"`};
 assert.equal((await call('/direcciones/'+row.id,{method:'DELETE',headers})).status,200);
 const data=(await call('/direcciones/sugerencias',{headers})).body.data;
 assert.equal(data.regreso,null);assert.ok(data.origenes.every(d=>d.direccion!=='Origen borrado'));
});
test('Caída M6: importación informa 503, favoritos continúan disponibles',async()=>{
 await new Promise(r=>m6.close(r));m6=null;
 const r=await call('/direcciones/desde-viaje',{method:'POST',body:JSON.stringify({viajeId:randomUUID()})});assert.equal(r.status,503);
 assert.equal((await create({...point,latitud:-15})).status,201);
 assert.equal((await call('/direcciones')).status,200);
 const cached=await call('/direcciones/sugerencias',{headers:{Authorization:'Bearer '+token(textClient)}});
 assert.equal(cached.status,200);assert.equal(cached.body.data.regreso.origen.direccion,'Centro Comercial');
});
