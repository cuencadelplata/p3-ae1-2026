import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { createCalificacionSchema } from '../schemas/calificacion.schema';
import { calificacionService } from '../services/calificacion.service';
import {
  Modulo6UnavailableError,
  TripNotFoundError,
} from '../clients/modulo6.client';
import {
  DuplicateCalificacionError,
  ForbiddenError,
  InvalidTripStateError,
} from '../errors/custom.errors';

export class CalificacionController {
  /**
   * HTTP POST /calificaciones
   * Crear una nueva calificación para un conductor
   */
  async crearCalificacion(req: Request, res: Response): Promise<Response> {
    try {
      // Extraer el clienteId autenticado desde los headers de la petición HTTP
      const clienteIdHeader = req.headers['x-cliente-id'] || req.headers['x-user-id'];
      if (!clienteIdHeader || typeof clienteIdHeader !== 'string') {
        return res.status(400).json({
          status: 'error',
          code: 'MISSING_CLIENT_ID',
          message: "Se requiere el encabezado 'x-cliente-id' para identificar al cliente autenticado",
        });
      }

      // Validar el payload con el esquema Zod
      const validatedInput = createCalificacionSchema.parse(req.body);

      // Ejecutar servicio de creación
      const calificacion = await calificacionService.crearCalificacion(
        clienteIdHeader,
        validatedInput
      );

      return res.status(201).json({
        status: 'success',
        message: 'Calificación registrada exitosamente',
        data: calificacion,
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Error en la validación de los datos de entrada',
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      if (error instanceof ForbiddenError) {
        return res.status(403).json({
          status: 'error',
          code: 'FORBIDDEN',
          message: error.message,
        });
      }

      if (error instanceof InvalidTripStateError) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_TRIP_STATE',
          message: error.message,
        });
      }

      if (error instanceof TripNotFoundError) {
        return res.status(404).json({
          status: 'error',
          code: 'TRIP_NOT_FOUND',
          message: error.message,
        });
      }

      if (error instanceof DuplicateCalificacionError) {
        return res.status(409).json({
          status: 'error',
          code: 'DUPLICATE_RATING',
          message: error.message,
        });
      }

      if (error instanceof Modulo6UnavailableError) {
        return res.status(503).json({
          status: 'error',
          code: 'SERVICE_UNAVAILABLE',
          message: error.message,
        });
      }

      console.error('[CalificacionController Error]', error);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Ocurrió un error interno en el servidor al procesar la calificación',
      });
    }
  }

  /**
   * HTTP GET /calificaciones/viaje/:viajeId
   * Obtener la calificación asignada a un viaje (con caché Redis)
   */
  async obtenerCalificacionPorViajeId(req: Request, res: Response): Promise<Response> {
    try {
      const { viajeId } = req.params;
      if (!viajeId) {
        return res.status(400).json({
          status: 'error',
          code: 'MISSING_PARAM',
          message: 'El parámetro viajeId es requerido',
        });
      }

      const calificacion = await calificacionService.obtenerCalificacionPorViajeId(viajeId);

      if (!calificacion) {
        return res.status(404).json({
          status: 'error',
          code: 'CALIFICACION_NOT_FOUND',
          message: `No se encontró calificación para el viaje ID: ${viajeId}`,
        });
      }

      if (calificacion.clienteId !== req.headers['x-cliente-id']) return res.status(404).json({status:'error', code:'CALIFICACION_NOT_FOUND', message:'Calificación no encontrada'});
      return res.status(200).json({
        status: 'success',
        data: calificacion,
      });
    } catch (error: any) {
      console.error('[CalificacionController Error]', error);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error al consultar la calificación del viaje',
      });
    }
  }
}

export const calificacionController = new CalificacionController();
