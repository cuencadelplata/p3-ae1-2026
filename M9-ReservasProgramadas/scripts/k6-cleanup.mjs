/**
 * Limpieza ADMINISTRATIVA de datos de prueba k6 en un entorno AISLADO.
 *
 *   node scripts/k6-cleanup.mjs <RUN_ID>            -> solo informa (dry-run)
 *   node scripts/k6-cleanup.mjs <RUN_ID> --confirm  -> borra
 *
 * Borra únicamente las reservas cuyos clienteId ficticios se derivan de ese RUN_ID
 * (performance/k6/lib/ids.js) y sus eventos Outbox/Inbox. Nunca toca reservas ajenas,
 * no usa la API pública (DELETE es lógico) y no elimina volúmenes de Docker.
 * Se niega a correr contra una base que no sea local.
 */
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { clientPoolFor } from '../performance/k6/lib/ids.js';

const [runId, flag] = process.argv.slice(2);
if (runId === undefined || runId.startsWith('--')) {
  console.error('Uso: node scripts/k6-cleanup.mjs <RUN_ID> [--confirm]');
  process.exit(2);
}

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://m9:m9-local@localhost:5432/m9_reservas?schema=public';
const host = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(host)) {
  console.error(`Rechazado: DATABASE_URL apunta a "${host}", no a un entorno local aislado.`);
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const clientIds = clientPoolFor(runId);
  const reservations = await prisma.reservation.findMany({
    where: { clientId: { in: clientIds } },
    select: { id: true, status: true },
  });
  const ids = reservations.map(({ id }) => id);
  const byStatus = reservations.reduce((acc, { status }) => {
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`RUN_ID=${runId}: ${ids.length} reservas de prueba`, byStatus);

  if (flag !== '--confirm') {
    console.log('Dry-run: no se borró nada. Agregar --confirm para eliminar.');
  } else if (ids.length > 0) {
    const [inbox, outbox, deleted] = await prisma.$transaction([
      prisma.inboxEvent.deleteMany({ where: { aggregateId: { in: ids } } }),
      prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } }),
      prisma.reservation.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(
      `Eliminadas: ${deleted.count} reservas, ${outbox.count} eventos Outbox, ${inbox.count} Inbox.`,
    );
  }
} finally {
  await prisma.$disconnect();
}
