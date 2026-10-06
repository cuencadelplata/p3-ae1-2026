require('dotenv/config');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const api=process.env.TEST_API_URL||'http://localhost:3000';
test('Sin salida pública: GET mapas, token local y consulta directa M6 siguen operando',async()=>{
 // IP pública explícita: no confundir falta de DNS con falta de conectividad exterior.
 await assert.rejects(()=>new Promise((resolve,reject)=>{
  const socket=require('node:net').connect({host:'1.1.1.1',port:443});
  socket.setTimeout(2500);
  socket.once('connect',()=>{socket.destroy();resolve();});
  socket.once('error',reject);
  socket.once('timeout',()=>{socket.destroy();reject(Error('Sin salida pública'));});
 }));
 const token=execFileSync(process.execPath,['scripts/token.cjs','cliente-123'],{encoding:'utf8'}).trim();
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const maps=await fetch(api+'/api/v1/geocodificacion?q=Plaza',{headers});assert.equal(maps.status,200);assert.ok((await maps.json()).data.length>0);
 const imported=await fetch(api+'/api/v1/direcciones/desde-viaje',{method:'POST',headers,body:JSON.stringify({viajeId:'viaje-completado-1'})});assert.equal(imported.status,200);
 const list=await fetch(api+'/api/v1/direcciones?recientes=true',{headers});assert.equal(list.status,200);assert.ok((await list.json()).data.length>=2);
});
