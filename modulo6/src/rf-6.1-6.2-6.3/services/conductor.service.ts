import axios from 'axios';
import { redisClient } from './redis.service.js';

const M3_URL = process.env.M3_URL || 'http://localhost:4003';
const M3_TIMEOUT_MS = Number(process.env.M3_TIMEOUT_MS) || 3000;
//nos conectamos al servicio M3 para consultar el estado del conductor. En caso de que el M3 no esté disponible, lanzamos un error 503 para que el cliente pueda manejarlo.
const cliente = axios.create({ baseURL: M3_URL, timeout: M3_TIMEOUT_MS });

export interface EstadoConductor {
    conductorId: string;
    habilitado: boolean;
}

export async function consultarEstadoConductor(conductorId: string): Promise<EstadoConductor> {
    const cacheKey = `conductor:${conductorId}:estado`;

    try {
        // 1. RNF-06: Intentamos obtener el estado desde la caché de Redis
        const estadoEnCache = await redisClient.get(cacheKey);
        
        if (estadoEnCache) {
            console.log(`[Redis] Estado del conductor ${conductorId} recuperado de caché`);
            return JSON.parse(estadoEnCache);
        }

        // 2. Si no está en caché, consultamos al servicio síncrono M3
        const { data } = await cliente.get(`/conductor/${conductorId}/estado`);
        
        // 3. RNF-06: Guardamos la respuesta en Redis con expiración (TTL) de 60 segundos
        await redisClient.set(cacheKey, JSON.stringify(data), 'EX', 60);
        console.log(`[Redis] Estado del conductor ${conductorId} guardado en caché`);
        
        return data;

    } catch (error: any) {
        // RNF-14: Resiliencia ante fallos del M3
        if (error.code === 'ECONNABORTED' || !error.response) {
            throw new Error('503_SERVICE_UNAVAILABLE');
        }
        throw new Error('500_INTERNAL_ERROR: Error al consultar estado del conductor');
    }
}