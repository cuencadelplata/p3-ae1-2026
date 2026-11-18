// Dataset acotado: cada VU crea una reserva y después la reutiliza.
// Una iteración = una petición: 60% consulta, 20% listado, 10% horario, 10% recotización.
import { actualizar, crear, listar, obtener } from './api.js';
import { futureIso, reservaPayload } from './config.js';

let id = null;
export const steadyWorkload = () => {
  if (id === null) {
    id = crear(reservaPayload(__VU * 100_000))?.id ?? null;
    return;
  }
  const slot = __ITER % 10;
  if (slot < 6) obtener(id);
  else if (slot < 8) listar((__ITER % 3) + 1, 20);
  else if (slot === 8)
    actualizar(id, { fechaHoraProgramada: futureIso(2 * 24 * 60 + (__ITER % 240)) });
  else
    actualizar(id, {
      destino: `Destino sostenido ${__ITER % 97}`,
      vehiculo: __ITER % 20 === 9 ? 'AUTO' : 'MOTO',
    });
};
