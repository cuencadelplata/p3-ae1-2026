// Recotización en M7 (PATCH de vehículo/destino), paginación profunda, rechazos de negocio
// controlados (400), concurrencia en reservas compartidas e idempotencia de cancelación.
import { check, sleep } from 'k6';

import {
  actualizar,
  cancelar,
  conflictive,
  crear,
  listar,
  obtener,
  rechazoEsperadoCrear,
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

const SHARED = num('SHARED_RESERVATIONS', 4);
const PAGES = [1, 2, 3, 5, 8];
const SIZES = [10, 20, 50, 100];

export const options = {
  scenarios: {
    repricing: {
      executor: 'constant-vus',
      vus: num('VUS', 6),
      duration: duration('1m30s', '40s'),
    },
  },
  thresholds: BASE_THRESHOLDS,
  tags: testTags('repricing'),
  cloud: cloudOptions('recotización M7, paginación y validaciones'),
};

export function setup() {
  const sharedIds = [];
  for (let index = 0; index < SHARED; index += 1) {
    const reserva = crear(reservaPayload(850_000 + index));
    if (reserva !== null) sharedIds.push(reserva.id);
  }
  return { sharedIds };
}

export default function (data) {
  const index = __VU * 50_000 + __ITER;
  const sharedIds = data?.sharedIds ?? [];

  // 1) Crear reserva base en AUTO y luego recotizar a MOTO cambiando destino (invoca a M7 dos veces)
  const creada = crear({ ...reservaPayload(index), vehiculo: 'AUTO' });
  if (creada !== null) {
    const recotizada = actualizar(creada.id, {
      destino: `Aeropuerto Internacional ${index % 45}`,
      vehiculo: 'MOTO',
    });
    check(recotizada, {
      'repricing: actualizó a MOTO': (r) => r?.vehiculo === 'MOTO',
      'repricing: conserva tarifa numérica si M7 responde': (r) =>
        r?.tarifaEstimada === null || typeof r?.tarifaEstimada === 'number',
    });

    obtener(creada.id);

    // 2) Paginación profunda con distintos page y pageSize
    const page = PAGES[__ITER % PAGES.length];
    const pageSize = SIZES[(__ITER + __VU) % SIZES.length];
    listar(page, pageSize);

    // 3) Contención concurrente sobre reservas compartidas (cambiando vehículo y horario)
    if (sharedIds.length > 0) {
      const targetId = sharedIds[(__ITER + __VU) % sharedIds.length];
      conflictive('PATCH', targetId, {
        vehiculo: __ITER % 2 === 0 ? 'AUTO' : 'MOTO',
        fechaHoraProgramada: futureIso(2 * 24 * 60 + ((__ITER + __VU) % 500)),
      });
    }

    // 4) Rechazos de negocio controlados (1 de cada 4 iteraciones) para alimentar métricas 400
    if (__ITER % 4 === 0) {
      const base = reservaPayload(index);
      rechazoEsperadoCrear(
        { ...base, fechaHoraProgramada: '2020-01-01T00:00:00.000Z' },
        'FECHA_INVALIDA',
      );
      rechazoEsperadoCrear(
        { ...base, origen: 'Misma Direccion 123', destino: '  misma direccion 123 ' },
        'DATOS_INVALIDOS',
      );
    }

    // 5) Cancelación e idempotencia (doble DELETE y PATCH post-cancelación)
    if (cancelar(creada.id) !== null) {
      verificarIdempotenciaCancelacion(creada.id);
    }
  }

  sleep(num('THINK_TIME_SECONDS', 0.4));
}

export const handleSummary = buildSummary('repricing');
