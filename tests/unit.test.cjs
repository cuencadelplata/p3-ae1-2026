const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomUUID}=require('node:crypto');
const {createSchema,patchSchema,tripSchema,expectedVersion,canonical,locationKey}=require('../dist/direcciones/domain');
const {verifyToken}=require('../dist/direcciones/auth');
const {consume}=require('../dist/messaging/broker');
const point={direccion:'Plaza central',latitud:-27.45,longitud:-58.98};
const event=()=>({eventId:randomUUID(),type:'TripCompleted.v1',occurredAt:new Date().toISOString(),correlationId:'test',data:{viajeId:'trip',clienteId:'client',origen:point,destino:point}});
test('Valida coordenadas, tipo y rechaza identidad en cuerpo',()=>{
 assert.equal(createSchema.safeParse({...point,tipo:'ORIGEN'}).success,true);
 for(const change of [{latitud:91},{longitud:-181},{latitud:NaN},{tipo:'OTRO'},{clienteId:'victima'}]) assert.equal(createSchema.safeParse({...point,tipo:'DESTINO',...change}).success,false);
 assert.equal(patchSchema.safeParse({}).success,false);
 assert.equal(patchSchema.safeParse({favorita:false}).success,true);
});
test('Normalización y huella no dependen del orden JSON',()=>{
 assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
 assert.equal(locationKey({latitud:1.12345601,longitud:2}),locationKey({latitud:1.12345602,longitud:2}));
});
test('Control optimista requiere versión fuerte válida',()=>{
 assert.equal(expectedVersion('"2"'),2);
 assert.throws(()=>expectedVersion(),e=>e.status===428);
 for(const v of ['2','W/"2"','"0"','"9007199254740993"']) assert.throws(()=>expectedVersion(v),e=>e.status===400);
});
test('Token: firma, audiencia, rol y vencimiento',()=>{
 const secret='x'.repeat(40);
 const sign=(claims)=>{const p=Buffer.from(JSON.stringify(claims)).toString('base64url');return p+'.'+createHmac('sha256',secret).update(p).digest('base64url');};
 const good={sub:'cliente-123',aud:'m2',role:'Cliente',exp:Math.floor(Date.now()/1000)+60};
 assert.equal(verifyToken(sign(good),secret),'cliente-123');
 for(const claims of [{...good,exp:0},{...good,aud:'other'},{...good,role:'Conductor'},{...good,sub:'../../x'}]) assert.throws(()=>verifyToken(sign(claims),secret));
 assert.throws(()=>verifyToken(sign(good),'wrong'));
});
async function delivery(body,handler,headers={}){
 let receiver; const log=[];
 const channel={consume:async(_q,fn)=>receiver=fn,ack:()=>log.push('ack'),close:async()=>log.push('close'),publish:(_ex,key,content,options,cb)=>{log.push({key,headers:options.headers});cb(null);return true;}};
 await consume(channel,'test',tripSchema,handler);
 receiver({content:Buffer.from(typeof body==='string'?body:JSON.stringify(body)),properties:{headers}});
 await new Promise(r=>setImmediate(r));return log;
}
test('Ack ocurre después de persistencia completada',async()=>{
 let done=false; const log=await delivery(event(),async()=>{done=true;});assert.equal(done,true);assert.deepEqual(log,['ack']);
});
test('Error de procesamiento va a retry confirmado antes de ack',async()=>{
 const log=await delivery(event(),async()=>{throw Error('db down');});assert.equal(log[0].key,'test.retry');assert.equal(log[0].headers['x-retry'],1);assert.equal(log[1],'ack');
});
test('Mensaje inválido y reintentos agotados van a DLQ',async()=>{
 const bad=await delivery('{invalid',async()=>assert.fail());assert.equal(bad[0].key,'test.dlq');
 const exhausted=await delivery(event(),async()=>{throw Error();},{'x-retry':3});assert.equal(exhausted[0].key,'test.dlq');assert.equal(exhausted[1],'ack');
});
test('Si falla reenviar no hay ack; cierre permite redelivery',async()=>{
 let receiver;const log=[];
 const ch={consume:async(_q,fn)=>receiver=fn,ack:()=>log.push('ack'),close:async()=>log.push('close'),publish:(_e,_k,_b,_o,cb)=>{cb(Error('broker down'));return false;}};
 await consume(ch,'test',tripSchema,async()=>{throw Error();});
 receiver({content:Buffer.from(JSON.stringify(event())),properties:{}});
 await new Promise(r=>setImmediate(r));assert.deepEqual(log,['close']);
});

test('Demuestra la carrera del enfoque ingenuo comprobar-luego-insertar',async()=>{
 const rows=[];
 async function naive(){if(rows.length===0){await new Promise(r=>setImmediate(r));rows.push('misma-direccion');}}
 await Promise.all([naive(),naive()]);assert.equal(rows.length,2);
 // La prueba de integración equivalente exige un solo registro con la implementación real.
});

test('Direcciones textuales sin coordenadas; no admite una coordenada sola',()=>{
 assert.equal(createSchema.safeParse({direccion:'Calle Principal 100',tipo:'ORIGEN'}).success,true);
 assert.equal(createSchema.safeParse({direccion:'Calle Principal 100',tipo:'ORIGEN',latitud:0}).success,false);
 assert.equal(createSchema.safeParse({direccion:'Calle Principal 100',tipo:'ORIGEN',latitud:0,longitud:0}).success,true);
 assert.equal(locationKey({direccion:' CALLE  Principal 100 '}),locationKey({direccion:'calle principal 100'}));
 assert.notEqual(locationKey({direccion:'Calle Principal 100'}),locationKey({direccion:'Calle Principal 101'}));
});
