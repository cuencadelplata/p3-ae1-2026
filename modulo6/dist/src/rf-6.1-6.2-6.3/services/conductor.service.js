import axios from 'axios';
import { redisClient } from './redis.service.js';
const M3_URL = process.env.M3_URL || 'http://m3-api:3000';
const M3_TIMEOUT_MS = Number(process.env.M3_TIMEOUT_MS) || 3000;
// M3 expone el estado combinado en GET /api/conductor/:id/estado.
const cliente = axios.create({ baseURL: M3_URL.replace(/\/+$/, ''), timeout: M3_TIMEOUT_MS });
export async function consultarEstadoConductor(conductorId) {
    const cacheKey = `conductor:${conductorId}:estado`;
    try {
        // 1. RNF-06: Intentamos obtener el estado desde la caché de Redis
        const estadoEnCache = await redisClient.get(cacheKey);
        if (estadoEnCache) {
            const estado = JSON.parse(estadoEnCache);
            if (typeof estado.habilitado === 'boolean') {
                console.log(`[Redis] Estado del conductor ${conductorId} recuperado de caché`);
                return {
                    conductorId: typeof estado.conductorId === 'string' ? estado.conductorId : conductorId,
                    habilitado: estado.habilitado,
                };
            }
        }
        // 2. Si no está en caché, consultamos al servicio síncrono M3
        const { data } = await cliente.get(`/api/conductor/${encodeURIComponent(conductorId)}/estado`);
        if (!data || typeof data.habilitado !== 'boolean') {
            throw new Error('500_INTERNAL_ERROR: Respuesta inválida del servicio M3');
        }
        const estado = {
            conductorId: typeof data.usuarioID === 'string' ? data.usuarioID : conductorId,
            habilitado: data.habilitado,
        };
        // 3. RNF-06: Guardamos la respuesta en Redis con expiración (TTL) de 60 segundos
        await redisClient.set(cacheKey, JSON.stringify(estado), 'EX', 60);
        console.log(`[Redis] Estado del conductor ${conductorId} guardado en caché`);
        return estado;
    }
    catch (error) {
        // RNF-14: Resiliencia ante fallos del M3
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            throw new Error('404_CONDUCTOR_NOT_FOUND');
        }
        if (error.code === 'ECONNABORTED' || !error.response) {
            throw new Error('503_SERVICE_UNAVAILABLE');
        }
        throw new Error('500_INTERNAL_ERROR: Error al consultar estado del conductor');
    }
}
