import { RideRequestValidator } from '../../src/schemas/ride-request.schema';
import { CreateRideRequestDTO, GeoLocation } from '../../src/types/ride-request.types';

/**
 * Tests Unitarios — RideRequestValidator
 * Cubre: RF-5.1 (validación solicitud), RF-5.2 (búsqueda candidatos),
 *        RF-5.3 (ofertas TTL), RF-5.4 (aceptar/rechazar), RF-5.6 (cancelación)
 */
describe('RideRequestValidator', () => {
  // ==========================================================================
  //  RF-5.1: Solicitud de viaje — Validación de GeoLocation
  // ==========================================================================
  describe('RF-5.1 — validateGeoLocation', () => {
    it('debe aceptar coordenadas válidas de origen', () => {
      const geo: GeoLocation = { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco, CABA' };
      const errors = RideRequestValidator.validateGeoLocation(geo, 'origin');
      expect(errors).toHaveLength(0);
    });

    it('debe rechazar latitud fuera de rango (-90 a 90)', () => {
      const geo: GeoLocation = { latitude: -91, longitude: -58.3816, address: 'Dirección válida' };
      const errors = RideRequestValidator.validateGeoLocation(geo, 'origin');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('latitude');
    });

    it('debe rechazar longitud fuera de rango (-180 a 180)', () => {
      const geo: GeoLocation = { latitude: -34.6037, longitude: 200, address: 'Dirección válida' };
      const errors = RideRequestValidator.validateGeoLocation(geo, 'destination');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('longitude');
    });

    it('debe rechazar dirección vacía o menor a 3 caracteres', () => {
      const geo: GeoLocation = { latitude: -34.6037, longitude: -58.3816, address: 'AB' };
      const errors = RideRequestValidator.validateGeoLocation(geo, 'origin');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('address');
    });

    it('debe rechazar GeoLocation nulo', () => {
      const errors = RideRequestValidator.validateGeoLocation(null as any, 'origin');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('requerido');
    });

    it('debe aceptar coordenadas en los límites exactos (90, 180)', () => {
      const geo: GeoLocation = { latitude: 90, longitude: 180, address: 'Polo Norte' };
      const errors = RideRequestValidator.validateGeoLocation(geo, 'origin');
      expect(errors).toHaveLength(0);
    });

    it('debe aceptar coordenadas negativas en los límites (-90, -180)', () => {
      const geo: GeoLocation = { latitude: -90, longitude: -180, address: 'Polo Sur' };
      const errors = RideRequestValidator.validateGeoLocation(geo, 'origin');
      expect(errors).toHaveLength(0);
    });
  });

  // ==========================================================================
  //  RF-5.1: Solicitud de viaje — calculateDistanceMeters (Haversine)
  // ==========================================================================
  describe('RF-5.1 — calculateDistanceMeters', () => {
    it('debe calcular distancia ~0 para puntos idénticos', () => {
      const loc: GeoLocation = { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' };
      const distance = RideRequestValidator.calculateDistanceMeters(loc, loc);
      expect(distance).toBeLessThan(1); // Prácticamente 0
    });

    it('debe calcular distancia mayor a 100m para puntos distantes', () => {
      const origin: GeoLocation = { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' };
      const dest: GeoLocation = { latitude: -34.5885, longitude: -58.3974, address: 'Recoleta' };
      const distance = RideRequestValidator.calculateDistanceMeters(origin, dest);
      expect(distance).toBeGreaterThan(100);
    });

    it('debe retornar un número positivo para cualquier par de puntos distintos', () => {
      const origin: GeoLocation = { latitude: 0, longitude: 0, address: 'Punto A' };
      const dest: GeoLocation = { latitude: 1, longitude: 1, address: 'Punto B' };
      const distance = RideRequestValidator.calculateDistanceMeters(origin, dest);
      expect(distance).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  //  RF-5.1: Solicitud de viaje — validateCreateRequest (payload completo)
  // ==========================================================================
  describe('RF-5.1 — validateCreateRequest', () => {
    const validDTO: CreateRideRequestDTO = {
      origin: { latitude: -34.6037, longitude: -58.3816, address: 'Av. 9 de Julio y Corrientes (Obelisco)' },
      destination: { latitude: -34.5885, longitude: -58.3974, address: 'Av. Alvear 1891 (Recoleta)' },
      vehicleType: 'AUTO',
    };

    it('debe validar exitosamente un DTO correcto con vehicleType AUTO', () => {
      const result = RideRequestValidator.validateCreateRequest(validDTO);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('debe validar exitosamente un DTO correcto con vehicleType MOTO', () => {
      const dto: CreateRideRequestDTO = { ...validDTO, vehicleType: 'MOTO' };
      const result = RideRequestValidator.validateCreateRequest(dto);
      expect(result.valid).toBe(true);
    });

    it('debe rechazar vehicleType inválido', () => {
      const dto = { ...validDTO, vehicleType: 'BICICLETA' as any };
      const result = RideRequestValidator.validateCreateRequest(dto);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('vehicleType'))).toBe(true);
    });

    it('debe rechazar cuando origen y destino son idénticos (< 100m)', () => {
      const dto: CreateRideRequestDTO = {
        ...validDTO,
        destination: { ...validDTO.origin },
      };
      const result = RideRequestValidator.validateCreateRequest(dto);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('100 metros'))).toBe(true);
    });

    it('debe rechazar un DTO nulo', () => {
      const result = RideRequestValidator.validateCreateRequest(null as any);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cuerpo de solicitud requerido');
    });

    it('debe acumular múltiples errores de validación', () => {
      const dto = {
        origin: { latitude: -999, longitude: -999, address: '' },
        destination: { latitude: 999, longitude: 999, address: '' },
        vehicleType: 'CAMION' as any,
      };
      const result = RideRequestValidator.validateCreateRequest(dto);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ==========================================================================
  //  RF-5.2: Búsqueda de candidatos — validateSearchCandidatesOptions
  // ==========================================================================
  describe('RF-5.2 — validateSearchCandidatesOptions', () => {
    it('debe validar exitosamente opciones vacías (usa defaults)', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({});
      expect(result.valid).toBe(true);
    });

    it('debe validar opciones undefined (usa defaults)', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions(undefined);
      expect(result.valid).toBe(true);
    });

    it('debe aceptar radiusKm válido (ej. 10)', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ radiusKm: 10 });
      expect(result.valid).toBe(true);
    });

    it('debe rechazar radiusKm = 0', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ radiusKm: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('radiusKm');
    });

    it('debe rechazar radiusKm > 50', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ radiusKm: 51 });
      expect(result.valid).toBe(false);
    });

    it('debe rechazar radiusKm negativo', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ radiusKm: -5 });
      expect(result.valid).toBe(false);
    });

    it('debe aceptar maxCandidates válido (ej. 5)', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ maxCandidates: 5 });
      expect(result.valid).toBe(true);
    });

    it('debe rechazar maxCandidates = 0', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ maxCandidates: 0 });
      expect(result.valid).toBe(false);
    });

    it('debe rechazar maxCandidates > 50', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ maxCandidates: 51 });
      expect(result.valid).toBe(false);
    });

    it('debe rechazar maxCandidates decimal (no entero)', () => {
      const result = RideRequestValidator.validateSearchCandidatesOptions({ maxCandidates: 3.5 });
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  //  RF-5.3: Oferta con vencimiento — validateSendOffersDTO
  // ==========================================================================
  describe('RF-5.3 — validateSendOffersDTO', () => {
    it('debe validar exitosamente un DTO vacío (usa defaults)', () => {
      const result = RideRequestValidator.validateSendOffersDTO({});
      expect(result.valid).toBe(true);
    });

    it('debe validar exitosamente con driverIds válidos', () => {
      const result = RideRequestValidator.validateSendOffersDTO({
        driverIds: ['drv_101', 'drv_102'],
      });
      expect(result.valid).toBe(true);
    });

    it('debe rechazar driverIds vacío (array sin elementos)', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ driverIds: [] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('driverIds');
    });

    it('debe rechazar driverIds con IDs inválidos (string vacío)', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ driverIds: ['drv_101', ''] });
      expect(result.valid).toBe(false);
    });

    it('debe aceptar ttlSeconds = 30 (default esperado)', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ ttlSeconds: 30 });
      expect(result.valid).toBe(true);
    });

    it('debe aceptar ttlSeconds en el rango mínimo (5)', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ ttlSeconds: 5 });
      expect(result.valid).toBe(true);
    });

    it('debe aceptar ttlSeconds en el rango máximo (180)', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ ttlSeconds: 180 });
      expect(result.valid).toBe(true);
    });

    it('debe rechazar ttlSeconds < 5', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ ttlSeconds: 4 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('ttlSeconds');
    });

    it('debe rechazar ttlSeconds > 180', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ ttlSeconds: 181 });
      expect(result.valid).toBe(false);
    });

    it('debe rechazar ttlSeconds decimal', () => {
      const result = RideRequestValidator.validateSendOffersDTO({ ttlSeconds: 30.5 });
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  //  RF-5.4: Aceptar o rechazar — validateRespondOfferDTO
  // ==========================================================================
  describe('RF-5.4 — validateRespondOfferDTO', () => {
    it('debe aceptar action ACCEPT', () => {
      const result = RideRequestValidator.validateRespondOfferDTO({ action: 'ACCEPT' });
      expect(result.valid).toBe(true);
    });

    it('debe aceptar action REJECT', () => {
      const result = RideRequestValidator.validateRespondOfferDTO({ action: 'REJECT' });
      expect(result.valid).toBe(true);
    });

    it('debe rechazar action inválida', () => {
      const result = RideRequestValidator.validateRespondOfferDTO({ action: 'CANCEL' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('action');
    });

    it('debe rechazar DTO vacío (sin action)', () => {
      const result = RideRequestValidator.validateRespondOfferDTO({});
      expect(result.valid).toBe(false);
    });

    it('debe rechazar DTO undefined', () => {
      const result = RideRequestValidator.validateRespondOfferDTO(undefined);
      expect(result.valid).toBe(false);
    });

    it('debe rechazar DTO null', () => {
      const result = RideRequestValidator.validateRespondOfferDTO(null as any);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  //  RF-5.6: Cancelación previa — validateCancelRequestDTO
  // ==========================================================================
  describe('RF-5.6 — validateCancelRequestDTO', () => {
    it('debe aceptar motivo de cancelación válido', () => {
      const result = RideRequestValidator.validateCancelRequestDTO({ reason: 'Cambio de planes' });
      expect(result.valid).toBe(true);
    });

    it('debe aceptar DTO vacío (motivo opcional)', () => {
      const result = RideRequestValidator.validateCancelRequestDTO({});
      expect(result.valid).toBe(true);
    });

    it('debe aceptar DTO undefined', () => {
      const result = RideRequestValidator.validateCancelRequestDTO(undefined);
      expect(result.valid).toBe(true);
    });

    it('debe rechazar motivo mayor a 255 caracteres', () => {
      const longReason = 'X'.repeat(256);
      const result = RideRequestValidator.validateCancelRequestDTO({ reason: longReason });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('255');
    });

    it('debe aceptar motivo de exactamente 255 caracteres', () => {
      const exactReason = 'X'.repeat(255);
      const result = RideRequestValidator.validateCancelRequestDTO({ reason: exactReason });
      expect(result.valid).toBe(true);
    });

    it('debe rechazar motivo que no sea string', () => {
      const result = RideRequestValidator.validateCancelRequestDTO({ reason: 12345 as any });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('texto');
    });
  });
});
