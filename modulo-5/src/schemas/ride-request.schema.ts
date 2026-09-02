import { CreateRideRequestDTO, GeoLocation, VehicleType } from '../types/ride-request.types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validador puro para la solicitud de viaje (RF-5.1)
 */
export class RideRequestValidator {
  /**
   * Valida un objeto de coordenadas geográficas
   */
  public static validateGeoLocation(geo: GeoLocation, fieldName: 'origin' | 'destination'): string[] {
    const errors: string[] = [];
    if (!geo) {
      errors.push(`${fieldName}: Campo requerido`);
      return errors;
    }

    if (typeof geo.latitude !== 'number' || isNaN(geo.latitude) || geo.latitude < -90 || geo.latitude > 90) {
      errors.push(`${fieldName}.latitude: Debe ser un número válido entre -90 y 90`);
    }

    if (typeof geo.longitude !== 'number' || isNaN(geo.longitude) || geo.longitude < -180 || geo.longitude > 180) {
      errors.push(`${fieldName}.longitude: Debe ser un número válido entre -180 y 180`);
    }

    if (!geo.address || typeof geo.address !== 'string' || geo.address.trim().length < 3) {
      errors.push(`${fieldName}.address: Debe contener al menos 3 caracteres`);
    }

    return errors;
  }

  /**
   * Calcula distancia aproximada en metros usando la fórmula de Haversine
   */
  public static calculateDistanceMeters(loc1: GeoLocation, loc2: GeoLocation): number {
    const R = 6371e3; // Radio de la Tierra en metros
    const lat1Rad = (loc1.latitude * Math.PI) / 180;
    const lat2Rad = (loc2.latitude * Math.PI) / 180;
    const deltaLat = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
    const deltaLng = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Valida la carga útil completa de creación de solicitud
   */
  public static validateCreateRequest(dto: CreateRideRequestDTO): ValidationResult {
    const errors: string[] = [];

    if (!dto) {
      return { valid: false, errors: ['Cuerpo de solicitud requerido'] };
    }

    errors.push(...this.validateGeoLocation(dto.origin, 'origin'));
    errors.push(...this.validateGeoLocation(dto.destination, 'destination'));

    const validVehicles: VehicleType[] = ['AUTO', 'MOTO'];
    if (!dto.vehicleType || !validVehicles.includes(dto.vehicleType)) {
      errors.push("vehicleType: Tipo inválido. Debe ser 'AUTO' o 'MOTO'");
    }

    // Validación cruzada: Origen y destino no pueden ser idénticos (mínimo 100 metros)
    if (dto.origin && dto.destination && errors.length === 0) {
      const distance = this.calculateDistanceMeters(dto.origin, dto.destination);
      if (distance < 100) {
        errors.push('destination: El destino debe estar a más de 100 metros del punto de origen');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida opciones de búsqueda de candidatos (RF-5.2)
   */
  public static validateSearchCandidatesOptions(options?: { radiusKm?: unknown; maxCandidates?: unknown }): ValidationResult {
    const errors: string[] = [];

    if (options?.radiusKm !== undefined) {
      if (typeof options.radiusKm !== 'number' || isNaN(options.radiusKm) || options.radiusKm <= 0 || options.radiusKm > 50) {
        errors.push('radiusKm: Debe ser un número positivo entre 0.1 y 50 km');
      }
    }

    if (options?.maxCandidates !== undefined) {
      if (typeof options.maxCandidates !== 'number' || !Number.isInteger(options.maxCandidates) || options.maxCandidates <= 0 || options.maxCandidates > 50) {
        errors.push('maxCandidates: Debe ser un entero positivo entre 1 y 50');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida opciones de envío de ofertas con vencimiento (RF-5.3)
   */
  public static validateSendOffersDTO(dto?: { driverIds?: unknown; ttlSeconds?: unknown }): ValidationResult {
    const errors: string[] = [];

    if (dto?.driverIds !== undefined) {
      if (!Array.isArray(dto.driverIds) || dto.driverIds.length === 0) {
        errors.push('driverIds: Si se especifica, debe ser un arreglo con al menos un ID de conductor');
      } else {
        dto.driverIds.forEach((id, idx) => {
          if (typeof id !== 'string' || id.trim().length === 0) {
            errors.push(`driverIds[${idx}]: Debe ser una cadena de texto válida`);
          }
        });
      }
    }

    if (dto?.ttlSeconds !== undefined) {
      if (typeof dto.ttlSeconds !== 'number' || isNaN(dto.ttlSeconds) || !Number.isInteger(dto.ttlSeconds) || dto.ttlSeconds < 5 || dto.ttlSeconds > 180) {
        errors.push('ttlSeconds: El tiempo máximo de respuesta debe ser un entero entre 5 y 180 segundos');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida respuesta a una oferta de viaje (RF-5.4)
   */
  public static validateRespondOfferDTO(dto?: { action?: unknown }): ValidationResult {
    const errors: string[] = [];

    if (!dto || !dto.action) {
      errors.push("action: Campo requerido. Debe ser 'ACCEPT' o 'REJECT'");
      return { valid: false, errors };
    }

    const validActions = ['ACCEPT', 'REJECT'];
    if (typeof dto.action !== 'string' || !validActions.includes(dto.action)) {
      errors.push("action: Valor inválido. Debe ser 'ACCEPT' o 'REJECT'");
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida cancelación previa de solicitud de viaje (RF-5.6)
   */
  public static validateCancelRequestDTO(dto?: { reason?: unknown }): ValidationResult {
    const errors: string[] = [];

    if (dto && dto.reason !== undefined && dto.reason !== null) {
      if (typeof dto.reason !== 'string') {
        errors.push('reason: El motivo de cancelación debe ser un texto');
      } else if (dto.reason.length > 255) {
        errors.push('reason: El motivo de cancelación no puede exceder 255 caracteres');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}




