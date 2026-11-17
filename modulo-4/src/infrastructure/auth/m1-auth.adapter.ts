import type { M1UserValidationResponse } from '../../domain/entities/location.entity.js';
import { ForbiddenError, UnauthorizedError } from '../../domain/errors/location.errors.js';
import type { AuthService } from '../../ports/auth-service.port.js';
import { Logger } from '../logger/structured.logger.js';

export class M1AuthAdapter implements AuthService {
  public constructor(
    private readonly m1Url: string,
    private readonly skipValidation = false
  ) {}

  public async validateConductorIdentity(token: string, targetDriverId: number): Promise<M1UserValidationResponse> {
    if (this.skipValidation) {
      return {
        valid: true,
        userId: targetDriverId,
        role: 'CONDUCTOR'
      };
    }

    if (!token) {
      throw new UnauthorizedError('Se requiere un token Bearer en el encabezado Authorization');
    }

    const cleanToken = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    try {
      const endpoint = `${this.m1Url.replace(/\/$/, '')}/auth/validar-identidad-y-rol`;
      Logger.info(`Validando token e identidad de conductor en M1: ${endpoint}`, { targetDriverId });

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: cleanToken,
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        Logger.warn(`M1 devolvió un estado HTTP no exitoso: ${response.status}`, { targetDriverId });
        throw new UnauthorizedError('Token no válido según el servicio de autenticación M1');
      }

      const body = (await response.json()) as Partial<M1UserValidationResponse>;

      if (!body.valid) {
        throw new ForbiddenError('La validación del token en M1 devolvió valid: false');
      }

      if (body.role !== 'CONDUCTOR') {
        throw new ForbiddenError(`El rol del usuario (${body.role}) no corresponde a CONDUCTOR`);
      }

      if (body.userId !== targetDriverId) {
        throw new ForbiddenError(
          `El userId canónico devuelto por M1 (${body.userId}) no coincide con el driverId solicitado (${targetDriverId})`
        );
      }

      return {
        valid: true,
        userId: body.userId,
        role: body.role
      };
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
        throw error;
      }
      Logger.error('Falla inesperada al comunicar con el servicio M1', error);
      throw new UnauthorizedError('Falla en la validación de identidad con el servicio M1');
    }
  }
}
