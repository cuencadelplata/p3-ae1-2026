import type { RouteResolver } from '../../src/integration/route-estimate.port.js';

export const routeSnapshot = {
  origin: { latitude: -27.46, longitude: -58.83, address: 'Origen' },
  destination: { latitude: -27.48, longitude: -58.78, address: 'Destino' },
  distanceKm: 10,
  estimatedDurationMin: 20,
};

export const routeResolverDemo = (): RouteResolver => ({
  resolve: async (origin, destination) => ({
    ...structuredClone(routeSnapshot),
    origin: { ...routeSnapshot.origin, address: origin },
    destination: { ...routeSnapshot.destination, address: destination },
  }),
});

export const fareEstimate = (amount = 2_500) => ({
  tarifaEstimada: amount,
  moneda: 'ARS',
  estimacionId: 'est_test',
  distanciaKm: routeSnapshot.distanceKm,
  tiempoEstimadoMin: routeSnapshot.estimatedDurationMin,
  calculadoEn: '2026-09-29T12:00:00.000Z',
});
