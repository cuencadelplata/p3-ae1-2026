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
}
