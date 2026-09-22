import { randomUUID } from 'node:crypto';

import type { AsignacionClient } from '../../src/clients/asignacion.client.js';
import type { AsignacionChofer } from '../../src/domain/reserva.js';

export const asignacionDemo = (): AsignacionChofer => ({
  id: randomUUID(),
  choferId: randomUUID(),
  nombreChofer: 'Chofer de prueba',
  valoracion: 4.9,
});

export const asignacionClientDemo = (): AsignacionClient => ({
  asignar: async () => asignacionDemo(),
  liberar: async () => {},
});
