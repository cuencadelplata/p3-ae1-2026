import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDemoToken } from './integration-demo.mjs';

const m9 = process.env.M9_TEST_URL || 'http://127.0.0.1:3000';
const m4 = process.env.M4_TEST_URL || 'http://127.0.0.1:3004';
const m7 = process.env.M7_TEST_URL || 'http://127.0.0.1:17000';
let authorization;
async function json(base, path, method = 'GET', body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        ...(base === m9 ? { authorization } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(new URL(base).origin + path + ': HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
async function geocode(address) {
  const point = await json(m4, '/api/v1/geocode', 'POST', { address });
  assert.equal(
    point.provider,
    'EXTERNAL_HTTP',
    'M4 debe usar su proveedor real, no coordenadas mockeadas.',
  );
  return point;
}
async function verify(reserva, from, to) {
  assert.ok(reserva.routeSnapshot, 'No se obtuvo una ruta de M4.');
  const route = reserva.routeSnapshot;
  assert.equal(route.origin.latitude, from.latitude);
  assert.equal(route.origin.longitude, from.longitude);
  assert.equal(route.destination.latitude, to.latitude);
  assert.equal(route.destination.longitude, to.longitude);
  const reference = await json(m4, '/api/v1/estimate', 'POST', {
    origin: { latitude: from.latitude, longitude: from.longitude },
    destination: { latitude: to.latitude, longitude: to.longitude },
  });
  assert.equal(route.distanceKm, reference.distanceKm);
  assert.equal(route.estimatedDurationMin, reference.estimatedEtaMinutes);
  const fare = await json(m7, '/tarifa/estimacion', 'POST', {
    origen: { lat: from.latitude, lng: from.longitude },
    destino: { lat: to.latitude, lng: to.longitude },
    distanciaKm: route.distanceKm,
    tiempoEstimadoMin: route.estimatedDurationMin,
    vehicleType: reserva.vehiculo === 'AUTO' ? 'auto' : 'moto',
  });
  assert.ok(reserva.tarifaEstimada > 0);
  assert.equal(reserva.tarifaEstimada, fare.estimatedFare);
  assert.equal(reserva.moneda, fare.currency);
}
async function main() {
  const token =
    process.env.M9_AUTH_TOKEN ||
    createDemoToken(
      JSON.parse(await readFile(new URL('../.integration/demo-auth.json', import.meta.url), 'utf8'))
        .secret,
    );
  authorization = 'Bearer ' + token;
  await json(m9, '/session');
  const origin = 'Plaza 25 de Mayo, Corrientes, Argentina';
  const destination = 'Terminal de Omnibus, Corrientes, Argentina';
  const changedDestination =
    'Aeropuerto Internacional Doctor Fernando Piragine Niveyro, Corrientes, Argentina';
  const from = await geocode(origin);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const to = await geocode(destination);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const nextTo = await geocode(changedDestination);
  let reservation;
  try {
    reservation = await json(m9, '/reservas', 'POST', {
      origen: origin,
      destino: destination,
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date(Date.now() + 3600000).toISOString(),
    });
    await verify(reservation, from, to);
    const updated = await json(m9, '/reservas/' + reservation.id, 'PATCH', {
      destino: changedDestination,
      vehiculo: 'MOTO',
    });
    await verify(updated, from, nextTo);
    assert.notDeepEqual(updated.routeSnapshot.destination, reservation.routeSnapshot.destination);
    const dateOnly = await json(m9, '/reservas/' + reservation.id, 'PATCH', {
      fechaHoraProgramada: new Date(Date.now() + 7200000).toISOString(),
    });
    assert.deepEqual(dateOnly.routeSnapshot, updated.routeSnapshot);
    assert.equal(dateOnly.estimacionTarifaId, updated.estimacionTarifaId);
    const evidence = {
      checkedAt: new Date().toISOString(),
      provider: 'M4/EXTERNAL_HTTP',
      reservationId: reservation.id,
      created: reservation,
      updated,
      dateOnly,
    };
    await mkdir(new URL('../performance/results/', import.meta.url), { recursive: true });
    await writeFile(
      new URL('../performance/results/real-routes-last.json', import.meta.url),
      JSON.stringify(evidence, null, 2),
    );
    console.log(
      'M4 real y M7 real: creacion, cambio de recorrido/vehiculo y cambio de fecha comprobados.',
    );
  } finally {
    if (reservation) await json(m9, '/reservas/' + reservation.id, 'DELETE');
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
