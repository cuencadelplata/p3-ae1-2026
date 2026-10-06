import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { z } from 'zod';
export const EXCHANGE='mobility.events';
export const TRIPS='m2.trip-completed';
export const FAVORITES='m8.favorite-address-changed';
export async function connect():Promise<{connection:ChannelModel; channel:ConfirmChannel}> {
  const connection=await amqp.connect(process.env.RABBITMQ_URL??'amqp://localhost',{timeout:3000});
  connection.on('error',()=>console.warn(JSON.stringify({event:'rabbitmq_connection_error'})));
  const channel=await connection.createConfirmChannel();
  channel.on('error',()=>console.warn(JSON.stringify({event:'rabbitmq_channel_error'})));
  await channel.assertExchange(EXCHANGE,'topic',{durable:true});
  for(const [queue,type] of [[TRIPS,'TripCompleted.v1'],[FAVORITES,'FavoriteAddressChanged.v1']]) {
    await channel.assertQueue(queue,{durable:true});
    await channel.bindQueue(queue,EXCHANGE,type);
    await channel.assertQueue(`${queue}.retry`,{durable:true,arguments:{'x-message-ttl':3000,'x-dead-letter-exchange':'','x-dead-letter-routing-key':queue}});
    await channel.assertQueue(`${queue}.dlq`,{durable:true});
  }
  await channel.prefetch(8);
  return {connection,channel};
}
export function publish(channel:ConfirmChannel,exchange:string,key:string,body:Buffer,options:any={}) {
  return new Promise<void>((resolve,reject)=>channel.publish(exchange,key,body,{persistent:true,contentType:'application/json',...options},err=>err?reject(err):resolve()));
}
export async function consume(channel:ConfirmChannel,queue:string,schema:z.ZodTypeAny,handler:(event:any)=>Promise<void>) {
  await channel.consume(queue,msg=>{
    if(msg) void handle(channel,queue,schema,handler,msg).catch(()=>{
      // No ack si ni siquiera se pudo reenviar; cerrar fuerza redelivery y reconexión.
      void channel.close().catch(()=>{});
    });
  },{noAck:false});
}
async function handle(channel:ConfirmChannel,queue:string,schema:z.ZodTypeAny,handler:(event:any)=>Promise<void>,msg:ConsumeMessage) {
  let event:any;
  try {event=schema.parse(JSON.parse(msg.content.toString()));}
  catch {
    await publish(channel,'',`${queue}.dlq`,msg.content,{headers:{'failure':'invalid_contract'}});
    channel.ack(msg); return;
  }
  try {
    await handler(event);
    channel.ack(msg);
    console.log(JSON.stringify({event:'message_processed',type:event.type,eventId:event.eventId,correlationId:event.correlationId}));
  } catch {
    const raw=Number(msg.properties.headers?.['x-retry']??0);
    const retry=Number.isFinite(raw)&&raw>=0?raw:0;
    await publish(channel,'',retry>=3?`${queue}.dlq`:`${queue}.retry`,msg.content,{messageId:event.eventId,headers:{'x-retry':retry+1,'failure':'processing_error'}});
    channel.ack(msg);
    console.warn(JSON.stringify({event:retry>=3?'message_dead_letter':'message_retry',eventId:event.eventId,attempt:retry+1}));
  }
}
