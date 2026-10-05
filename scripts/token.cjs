require('dotenv/config');
const {createHmac}=require('node:crypto');
const secret=process.env.AUTH_SECRET;
if(!secret||secret.length<32) throw Error('Definir AUTH_SECRET con al menos 32 caracteres');
const sub=process.argv[2]||'cliente-123';
if(!/^[a-zA-Z0-9_-]{1,100}$/.test(sub)) throw Error('Identificador inválido');
const payload=Buffer.from(JSON.stringify({sub,role:'Cliente',aud:'m2',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
console.log(payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url'));
