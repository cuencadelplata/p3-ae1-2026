import { prisma } from '../config/prisma';
import { redisClient } from '../config/redis';
import { modulo6Client } from '../clients/modulo6.client';
import { CreateCalificacionInput } from '../schemas/calificacion.schema';
import {
  DuplicateCalificacionError,
  ForbiddenError,
  InvalidTripStateError,
} from '../errors/custom.errors';

const CACHE_TTL_SECONDS = 86400; // 24 horas

export class CalificacionService {
  /**
   * Crea una nueva calificación para un viaje completado.
   *
   * @param clienteId ID del cliente autenticado que realiza la calificación
   * @param payload Datos de la calificación (viajeId, puntuacion, comentario)
   */
  async crearCalificacion(clienteId: string, payload: CreateCalificacionInput) {
    const { viajeId, puntuacion, comentario } = payload;
    const cacheKey = `calificacion:viaje:${viajeId}`;

    // 1. Verificación rápida en Redis para evitar llamadas innecesarias al Módulo 6 si ya existe
    const cachedData = await redisClient.get(cacheKey).catch(() => null);
    if (cachedData) {
      throw new DuplicateCalificacionError(viajeId);
    }

    // 2. Consulta sincrónica al Módulo 6 (Viajes) con Circuit Breaker
    const viaje = await modulo6Client.obtenerViajePorId(viajeId);

    // 3. Validación de pertenencia del cliente
    if (viaje.clienteId !== clienteId) {
      throw new ForbiddenError('El viaje especificado no pertenece al cliente autenticado');
    }

    // 4. Validación del estado del viaje ("completado")
    if (viaje.estado.toLowerCase() !== 'completado') {
      throw new InvalidTripStateError(viaje.estado);
    }

    // 5. Extracción del conductorId real y persistencia en DB relacional con control de duplicidad
    try {
      const nuevaCalificacion = await prisma.calificacion.create({
        data: {
          viajeId,
          clienteId,
          conductorId: viaje.conductorId,
          puntuacion,
          comentario: comentario || null,
        },
      });

      // 6. Almacenamiento en caché Redis (Cache-Aside / Write-Through cache write)
      await redisClient.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(nuevaCalificacion)).catch(() => undefined);

      return nuevaCalificacion;
    } catch (error: any) {
      // P2002 es el código de error de Prisma para violaciones de restricción única
      if (error.code === 'P2002') {
        throw new DuplicateCalificacionError(viajeId);
      }
      throw error;
    }
  }

  /**
   * Obtiene la calificación de un viaje implementando estrategia Cache-Aside con Redis.
   *
   * @param viajeId ID del viaje a consultar
   */
  async obtenerCalificacionPorViajeId(viajeId: string) {
    const cacheKey = `calificacion:viaje:${viajeId}`;

    // 1. Intentar obtener de la caché (Cache Hit)
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (cacheError) {
      console.warn('[Redis Cache Warning] Fallo al consultar la caché:', cacheError);
    }

    // 2. Si no está en caché (Cache Miss), consultar la base de datos PostgreSQL
    const calificacion = await prisma.calificacion.findUnique({
      where: { viajeId },
    });

    if (!calificacion) {
      return null;
    }

    // 3. Poblar la caché Redis para subsecuentes consultas
    try {
      await redisClient.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(calificacion));
    } catch (cacheError) {
      console.warn('[Redis Cache Warning] Fallo al guardar en caché:', cacheError);
    }

    return calificacion;
  }
}

export const calificacionService = new CalificacionService();
