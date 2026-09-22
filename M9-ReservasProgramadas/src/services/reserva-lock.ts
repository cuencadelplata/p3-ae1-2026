import type { ReservaRepository } from '../repositories/reserva.repository.js';

// Serializa edición, cancelación, asignación y activación por reserva en esta instancia.
// La persistencia distribuida futura deberá reemplazarlo por coordinación transaccional.
const locks = new WeakMap<ReservaRepository, Map<string, Promise<void>>>();

export const conReservaExclusiva = async <T>(
  repository: ReservaRepository,
  id: string,
  action: () => Promise<T>,
): Promise<T> => {
  let queue = locks.get(repository);
  if (queue === undefined) {
    queue = new Map();
    locks.set(repository, queue);
  }
  const previous = queue.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.set(id, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (queue.get(id) === current) queue.delete(id);
  }
};
