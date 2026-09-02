/**
 * Prueba de concurrencia e idempotencia (RF-8.3 / RNF-09).
 *
 * Lanza N solicitudes simultaneas de emision sobre un mismo tripId y verifica
 * que el servicio emita un unico comprobante. Genera la evidencia del portafolio.
 *
 * Uso: levantar el servicio (npm run dev) y ejecutar `npm run prueba:concurrencia`
 */
import { execSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://localhost:3008';
const SOLICITUDES = Number(process.env.SOLICITUDES ?? 8);
const tripId = `trip-concurrencia-${Date.now()}`;
const LINEA = '='.repeat(72);
const GUION = '-'.repeat(72);

function gitInfo(comando, fallback) {
  try {
    return execSync(comando, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

const cuerpo = {
  tripId,
  customer: { id: 'cli-0091', fullName: 'Lucia Fernandez', email: 'lucia.fernandez@example.com' },
  driver: {
    id: 'cnd-0457',
    fullName: 'Martin Rodriguez',
    vehicle: { type: 'AUTO', plate: 'AB123CD', model: 'Toyota Etios 2021' },
  },
  trip: {
    origin: 'Av. Colon 1250, Cordoba',
    destination: 'Aeropuerto Ambrosio Taravella',
    startedAt: '2026-08-28T13:05:00.000Z',
    finishedAt: '2026-08-28T13:36:00.000Z',
    distanceKm: 14.8,
    durationMin: 31,
  },
  fare: {
    currency: 'ARS',
    baseFare: 1200,
    distanceAmount: 5920,
    timeAmount: 1550,
    surcharges: 430,
    discounts: 600,
    total: 8500,
  },
  payment: { method: 'TARJETA', status: 'APROBADO', authorizationCode: 'AUTH-77321' },
};

async function main() {
  try {
    const salud = await fetch(`${BASE}/health`);
    if (!salud.ok) throw new Error(`estado ${salud.status}`);
  } catch (error) {
    console.error(`\nNo se pudo contactar el servicio en ${BASE} (${error.message}).`);
    console.error('Levantalo con "npm run dev" en otra terminal y volve a ejecutar esta prueba.\n');
    process.exit(1);
  }

  console.log(LINEA);
  console.log(' PRUEBA DE CONCURRENCIA E IDEMPOTENCIA - M8 Comprobantes');
  console.log(' RF-8.3 (Comprobante PDF) | RNF-09 (Consistencia y concurrencia)');
  console.log(LINEA);
  console.log(` Fecha       : ${new Date().toLocaleString('es-AR')}`);
  console.log(` Rama        : ${gitInfo('git rev-parse --abbrev-ref HEAD', 'desconocida')}`);
  console.log(` Commit      : ${gitInfo('git rev-parse --short HEAD', 'desconocido')}`);
  console.log(` Endpoint    : POST ${BASE}/api/v1/receipts`);
  console.log(` tripId      : ${tripId}`);
  console.log(` Solicitudes : ${SOLICITUDES} simultaneas sobre el mismo viaje`);
  console.log(GUION);

  const inicio = performance.now();
  const respuestas = await Promise.all(
    Array.from({ length: SOLICITUDES }, () =>
      fetch(`${BASE}/api/v1/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      }),
    ),
  );
  const transcurrido = performance.now() - inicio;

  const cuerpos = await Promise.all(respuestas.map((r) => r.json()));

  respuestas.forEach((respuesta, i) => {
    const datos = cuerpos[i].data;
    const etiqueta = respuesta.status === 201 ? '201 Created  (emitido)   ' : '200 OK       (idempotente)';
    console.log(
      ` #${String(i + 1).padStart(2)}  ${etiqueta}  ${datos.receiptNumber}  ${datos.receiptId.slice(0, 8)}`,
    );
  });

  const emitidos = respuestas.filter((r) => r.status === 201).length;
  const idempotentes = respuestas.filter((r) => r.status === 200).length;
  const receiptIds = new Set(cuerpos.map((c) => c.data.receiptId));
  const numeros = new Set(cuerpos.map((c) => c.data.receiptNumber));

  console.log(GUION);
  console.log(` 201 Created (comprobantes emitidos) : ${emitidos}`);
  console.log(` 200 OK (respuestas idempotentes)    : ${idempotentes}`);
  console.log(` receiptId distintos                 : ${receiptIds.size}`);
  console.log(` receiptNumber distintos             : ${numeros.size}`);
  console.log(` Tiempo total de las ${SOLICITUDES} solicitudes    : ${transcurrido.toFixed(0)} ms`);
  console.log(LINEA);

  const correcto = emitidos === 1 && idempotentes === SOLICITUDES - 1 && receiptIds.size === 1;
  if (correcto) {
    console.log(` RESULTADO: OK - ${SOLICITUDES} solicitudes simultaneas produjeron un unico comprobante`);
    console.log(` Comprobante: ${[...numeros][0]}`);
    console.log(LINEA);
    console.log();
    return;
  }

  console.log(' RESULTADO: FALLO - se detecto mas de un comprobante para el mismo viaje');
  console.log(LINEA);
  console.log();
  process.exit(1);
}

main();
