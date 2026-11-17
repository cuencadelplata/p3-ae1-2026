import { describe, expect, it } from 'vitest';
import { DistanceCalculator } from '../../src/domain/services/distance.calculator.js';
import { InvalidCoordinatesError } from '../../src/domain/errors/location.errors.js';

describe('DistanceCalculator (RF-4.5)', () => {
  it('debe calcular la distancia Haversine y ETA correctamente entre dos puntos conocidos', () => {
    const origin = { latitude: -27.4692, longitude: -58.8306 }; // Facultad Cuenca del Plata
    const destination = { latitude: -27.4875, longitude: -58.7896 }; // Terminal de Corrientes

    const result = DistanceCalculator.estimate(origin, destination);

    expect(result.distanceKm).toBeGreaterThan(3.5);
    expect(result.distanceKm).toBeLessThan(5.5);
    expect(result.estimatedEtaMinutes).toBeGreaterThanOrEqual(1);
  });

  it('debe lanzar InvalidCoordinatesError si la latitud o longitud están fuera de rango', () => {
    const invalidOrigin = { latitude: 95, longitude: -58.8306 };
    const validDestination = { latitude: -27.4875, longitude: -58.7896 };

    expect(() => DistanceCalculator.estimate(invalidOrigin, validDestination)).toThrow(
      InvalidCoordinatesError
    );
  });

  it('debe devolver ETA de al menos 1 minuto para distancias extremadamente cortas', () => {
    const origin = { latitude: -27.4692, longitude: -58.8306 };
    const destination = { latitude: -27.4693, longitude: -58.8307 };

    const result = DistanceCalculator.estimate(origin, destination);

    expect(result.estimatedEtaMinutes).toBe(1);
  });

  it('debe rechazar una velocidad promedio nula, negativa o no numérica', () => {
    const origin = { latitude: -27.4692, longitude: -58.8306 };
    const destination = { latitude: -27.4875, longitude: -58.7896 };

    expect(() => DistanceCalculator.estimate(origin, destination, 0)).toThrow(RangeError);
    expect(() => DistanceCalculator.estimate(origin, destination, -10)).toThrow(RangeError);
    expect(() => DistanceCalculator.estimate(origin, destination, Number.NaN)).toThrow(RangeError);
  });

  it('debe devolver la misma distancia sin importar el sentido del recorrido', () => {
    const a = { latitude: -27.4692, longitude: -58.8306 };
    const b = { latitude: -27.4875, longitude: -58.7896 };

    expect(DistanceCalculator.haversineDistance(a, b)).toBeCloseTo(DistanceCalculator.haversineDistance(b, a), 10);
  });
});
