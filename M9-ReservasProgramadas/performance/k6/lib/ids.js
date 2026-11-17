// Identificadores ficticios y deterministas por RUN_ID.
// Sin imports de k6 ni de Node: lo usan tanto los scripts k6 como la limpieza administrativa
// (scripts/k6-cleanup.mjs), que así borra SOLO las reservas de esa ejecución.

const fnv1a = (input, seed) => {
  let hash = 0x811c9dc5 ^ seed;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/** UUID v4 válido derivado de (runId, índice). No corresponde a ningún cliente real. */
export const clientIdFor = (runId, index) => {
  const key = `${runId}:${index}`;
  const hex = [1, 2, 3, 4].map((seed) => fnv1a(key, seed)).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
};

/** Cantidad de clientes ficticios por ejecución (las reservas se reparten entre ellos). */
export const CLIENT_POOL_SIZE = 50;

export const clientPoolFor = (runId, size = CLIENT_POOL_SIZE) =>
  Array.from({ length: size }, (_, index) => clientIdFor(runId, index));
