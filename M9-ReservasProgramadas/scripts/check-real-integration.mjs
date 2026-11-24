import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createDemoToken, DEMO_CLIENT_ID } from './integration-demo.mjs';

const m9 = 'http://127.0.0.1:3000';
const m5 = 'http://127.0.0.1:3005';
const m7 = 'http://127.0.0.1:17000';
let demoAuthorization;
const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));

async function json(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(new URL(url).origin === m9 ? { authorization: demoAuthorization } : {}),
        ...init.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { secret } = JSON.parse(
    await readFile(new URL('../.integration/demo-auth.json', import.meta.url), 'utf8'),
  );
  const authorization = `Bearer ${createDemoToken(secret)}`;
  demoAuthorization = authorization;
  const readyDeadline = Date.now() + 60000;
  while (true) {
    try {
      await json(`${m9}/readiness`);
      break;
    } catch {
      if (Date.now() >= readyDeadline) throw new Error('M9 no alcanzó readiness en 60 segundos.');
    }
    await pause();
  }
  const reservation = await json(`${m9}/reservas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clienteId: DEMO_CLIENT_ID,
      origen: 'Plaza 25 de Mayo, Corrientes, Argentina',
      destino: 'Terminal de Ómnibus, Corrientes, Argentina',
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date(Date.now() + 30000).toISOString(),
    }),
  });
  assert.ok(
    reservation.routeSnapshot,
    'No hay una ruta válida; revisar el modo de resolución configurado.',
  );
  assert.ok(
    reservation.tarifaEstimada > 0,
    'M9 degradó la tarifa: no se considera una integración aprobada.',
  );
  const route = reservation.routeSnapshot;
  const reference = await json(`${m7}/tarifa/estimacion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origen: { lat: route.origin.latitude, lng: route.origin.longitude },
      destino: { lat: route.destination.latitude, lng: route.destination.longitude },
      distanciaKm: route.distanceKm,
      tiempoEstimadoMin: route.estimatedDurationMin,
      vehicleType: 'auto',
    }),
  });
  assert.equal(
    reservation.tarifaEstimada,
    reference.estimatedFare,
    'La tarifa guardada no coincide con M7.',
  );
  console.log('M9 → M7: tarifa confirmada para la ruta configurada.');
  let current = reservation;
  const deadline = Date.now() + 90000;
  while (current.idSolicitud === null && Date.now() < deadline) {
    if (current.estado === 'FALLIDA')
      throw new Error('La reserva falló antes de confirmar una solicitud M5.');
    await pause();
    current = await json(`${m9}/reservas/${reservation.id}`);
  }
  assert.ok(
    current.idSolicitud,
    'El scheduler no confirmó despacho en M5. Revisar token, cron y logs.',
  );
  let request = await json(`${m5}/api/v1/ride-requests/${current.idSolicitud}`, {
    headers: { authorization },
  });
  assert.equal(request.clientId, DEMO_CLIENT_ID, 'M5 asoció la solicitud a otro cliente.');
  assert.equal(request.id, current.idSolicitud);
  console.log(`M9 → M5: solicitud ${request.id}, estado ${request.status}, cliente correcto.`);
  current = await json(`${m9}/reservas/${reservation.id}`);
  if (process.argv.includes('--expect-assigned')) {
    console.log('Esperando aceptacion REAL de un conductor en M5 (hasta 180 segundos)...');
    const assignmentDeadline = Date.now() + 180000;
    while (current.estado !== 'ACTIVADA' && Date.now() < assignmentDeadline) {
      if (current.estado === 'FALLIDA') throw new Error('La reserva fallo sin asignacion.');
      await pause();
      current = await json(m9 + '/reservas/' + reservation.id);
    }
    assert.equal(
      current.estado,
      'ACTIVADA',
      'No hubo aceptacion real en M5; no se considera aprobada la activacion.',
    );
    request = await json(m5 + '/api/v1/ride-requests/' + current.idSolicitud, {
      headers: { authorization },
    });
    assert.equal(request.status, 'ASSIGNED');
    assert.ok(request.assignedDriverId);
    assert.equal(current.assignedDriverId, request.assignedDriverId);
    console.log('Activacion y conductor asignado confirmados en M9 y M5.');
  }
  if (!process.argv.includes('--expect-assigned') && current.estado === 'ACTIVANDO') {
    await json(`${m9}/reservas/${reservation.id}`, { method: 'DELETE' });
    request = await json(`${m5}/api/v1/ride-requests/${request.id}`, {
      headers: { authorization },
    });
    assert.equal(request.status, 'CANCELLED', 'La cancelación no se reflejó en M5.');
    current = await json(`${m9}/reservas/${reservation.id}`);
    assert.equal(current.estado, 'CANCELADA');
    console.log('Cancelación M9 → M5 confirmada.');
  }
  const evidence = {
    checkedAt: new Date().toISOString(),
    reservaId: reservation.id,
    requestId: request.id,
    clienteId: DEMO_CLIENT_ID,
    estadoM9: current.estado,
    estadoM5: request.status,
  };
  await writeFile(
    new URL('../.integration/check-last.json', import.meta.url),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    'Integración REST comprobada. La asignación de un conductor y la creación de un viaje en M6 requieren su flujo real; esta prueba no las simula.',
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
