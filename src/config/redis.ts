import 'dotenv/config';
import Redis from 'ioredis';
export const redisClient=new Redis({host:process.env.REDIS_HOST??'localhost',port:Number(process.env.REDIS_PORT??6379),password:process.env.REDIS_PASSWORD||undefined,connectTimeout:1000,commandTimeout:1000,maxRetriesPerRequest:1,enableOfflineQueue:false,retryStrategy:times=>Math.min(times*200,3000)});
redisClient.on('error',()=>console.warn(JSON.stringify({level:'warn',event:'redis_unavailable'})));
