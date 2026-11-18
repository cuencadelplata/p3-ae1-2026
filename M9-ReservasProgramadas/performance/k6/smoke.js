// Smoke: 1–2 VUs ~30 s. CRUD completo con múltiples solicitudes, recotización en M7,
// paginación y verificación de idempotencia tras cancelación.
import { check, sleep } from 'k6';

import {
  actualizar,
  cancelar,
  crear,
  listar,
  obtener,
  verificarIdempotenciaCancelacion,
} from './lib/api.js';
import {
  BASE_THRESHOLDS,
  cloudOptions,
  duration,
  futureIso,
  num,
  reservaPayload,
  testTags,
} from './lib/config.js';
import { buildSummary } from './lib/summary.js';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: num('VUS', 2),
      duration: duration('30s', '30s'),
    },
  },
  thresholds: BASE_THRESHOLDS,
  tags: testTags('smoke'),
  cloud: cloudOptions('smoke'),
};

export default function () {
  const index = __VU * 10_000 + __ITER * 2;
  const creadaA = crear(reservaPayload(index));
  const creadaB = crear(reservaPayload(index + 1));
  if (creadaA === null || creadaB === null) return;

  obtener(creadaA.id);
  obtener(creadaB.id);
  listar(1, 20);
  listar(2, 10);

  // 1) Modificación de fecha y hora
  const nuevaFecha = futureIso(3 * 24 * 60);
  const actualizadaA = actualizar(creadaA.id, { fechaHoraProgramada: nuevaFecha });
  check(actualizadaA, {
    'smoke: sigue PROGRAMADA tras modificar horario': (r) => r?.estado === 'PROGRAMADA',
  });

  // 2) Modificación de vehículo y destino (fuerza recotización en M7 y lock en Redis)
  const nuevoVehiculo = creadaB.vehiculo === 'AUTO' ? 'MOTO' : 'AUTO';
  const actualizadaB = actualizar(creadaB.id, {
    destino: `Destino recotizado ${index}`,
    vehiculo: nuevoVehiculo,
  });
  check(actualizadaB, {
    'smoke: recotiza y mantiene PROGRAMADA': (r) =>
      r?.estado === 'PROGRAMADA' && r?.vehiculo === nuevoVehiculo,
  });

  // 3) Cancelación e idempotencia (segundo DELETE y PATCH post-cancelación deben dar 409)
  cancelar(creadaA.id);
  verificarIdempotenciaCancelacion(creadaA.id);

  cancelar(creadaB.id);
  const final = obtener(creadaA.id);
  check(final, { 'smoke: CANCELADA persiste (borrado lógico)': (r) => r?.estado === 'CANCELADA' });
  sleep(1);
}

export const handleSummary = buildSummary('smoke');
