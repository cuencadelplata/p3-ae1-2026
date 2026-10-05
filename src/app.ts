import 'dotenv/config';
import express,{ErrorRequestHandler} from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { prisma } from './config/prisma';
import { redisClient } from './config/redis';
import { authenticate } from './direcciones/auth';
import { ApiError } from './direcciones/domain';
import { router } from './direcciones/routes';
import ratings from './routes/calificacion.routes';
export const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  const proposed=req.get('x-correlation-id');
  res.locals.correlationId=proposed&&/^[a-zA-Z0-9_-]{1,100}$/.test(proposed)?proposed:randomUUID();
  res.set('x-correlation-id',res.locals.correlationId);
  res.on('finish',()=>console.log(JSON.stringify({event:'http_request',method:req.method,status:res.statusCode,correlationId:res.locals.correlationId})));
  next();
});
app.use(express.json({limit:'32kb'}));
app.get('/health/live',(_req,res)=>res.json({status:'up',service:'m2-clientes'}));
app.get(['/health','/health/ready'],async(_req,res)=>{
  const checks=await Promise.allSettled([prisma.$queryRaw`SELECT 1`,redisClient.ping(),prisma.outbox.count({where:{publicadoAt:null}}),redisClient.get('m2:worker:heartbeat')]);
  const database=checks[0].status==='fulfilled',redis=checks[1].status==='fulfilled';
  const worker=checks[3].status==='fulfilled' && checks[3].value!==null;
  res.status(database?200:503).json({status:database?(redis&&worker?'ready':'degraded'):'not_ready',dependencies:{database,redis,worker},pendingEvents:checks[2].status==='fulfilled'?checks[2].value:null,asyncDelivery:'Consultar heartbeat del worker; API acepta cambios en outbox aunque RabbitMQ esté caído'});
});
app.get('/openapi.json',(_req,res)=>res.sendFile('openapi.json',{root:process.cwd()+'/docs'}));
app.use('/api/v1',authenticate,router,ratings);
// Rutas heredadas conservadas, ahora autenticadas.
app.use('/',(req,res,next)=>req.path.startsWith('/calificaciones')?authenticate(req,res,next):next(),ratings);
app.use((_req,_res,next)=>next(new ApiError(404,'NOT_FOUND','Ruta no encontrada')));
const errors:ErrorRequestHandler=(err,_req,res,_next)=>{
  let status=500,code='INTERNAL_ERROR',message='Error interno';
  if(err instanceof ApiError) ({status,code,message}=err);
  else if(err instanceof ZodError){status=400;code='VALIDATION_ERROR';message='Datos inválidos';}
  else if(err.type==='entity.parse.failed'){status=400;code='INVALID_JSON';message='JSON inválido';}
  else if(err.type==='entity.too.large'){status=413;code='PAYLOAD_TOO_LARGE';message='Cuerpo demasiado grande';}
  else if(['P1001','P1002','P1008','P1017','P2024'].includes(err.code)){status=503;code='DATABASE_UNAVAILABLE';message='Persistencia no disponible';}
  if(status===500) console.error(JSON.stringify({event:'request_failed',correlationId:res.locals.correlationId}));
  res.status(status).json({status:'error',code,message,correlationId:res.locals.correlationId,...(err instanceof ZodError?{errors:err.issues.map(e=>({field:e.path.join('.'),message:e.message}))}:{})});
};
app.use(errors);
