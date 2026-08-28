const queues = new Map<string, Promise<unknown>>();

/**
 * Serializa las tareas que comparten una misma clave. Se usa para que dos
 * solicitudes concurrentes de emision del mismo viaje no generen dos
 * comprobantes distintos (RNF-09): la segunda espera a la primera y encuentra
 * el comprobante ya persistido.
 */
export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);

  const tail: Promise<void> = run.then(discard, discard);
  queues.set(key, tail);

  function discard(): void {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  }

  return run;
}
