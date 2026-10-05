import 'dotenv/config';
import { app } from './app';
import { prisma } from './config/prisma';
import { redisClient } from './config/redis';
if(!process.env.AUTH_SECRET||process.env.AUTH_SECRET.length<32) throw new Error('Configurar AUTH_SECRET (mínimo 32 caracteres)');
const server=app.listen(Number(process.env.PORT??3000),()=>console.log(JSON.stringify({event:'api_started',version:'2.2.0'})));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{
  server.close(()=>{redisClient.disconnect();void prisma.$disconnect().then(()=>process.exit(0));});
  setTimeout(()=>process.exit(1),10000).unref();
});
