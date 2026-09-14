import { test as prueba, before as antes } from 'node:test';
import verificar from 'node:assert/strict';

const origen = process.env.API_URL;
if (!origen) throw new Error('Falta API_URL: ejecutá los E2E con Docker.');

const ruta = '/clientes/cliente-1/calificaciones';
const datosValidos = {
  viajeId: 'viaje-1',
  puntuacion: 5,
  comentario: '  Excelente conductor.  '
};

async function solicitar(destino: string, metodo = 'GET', cuerpo?: unknown) {
  return fetch(new URL(destino, origen), {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(5000)
  });
}

async function listar() {
  const respuesta = await solicitar(ruta);
  verificar.equal(respuesta.status, 200);
  const lista = await respuesta.json();
  verificar.ok(Array.isArray(lista));
  return lista;
}

antes(async () => {
  verificar.deepEqual(
    await listar(), [],
    'Estos E2E necesitan una base sin calificaciones. Usá el entorno temporal de pruebas.'
  );
});

prueba('calificar, consultar, listar y rechazar una segunda valoración', async () => {
  const respuesta = await solicitar(ruta, 'POST', datosValidos);
  verificar.equal(respuesta.status, 201);
  const creada = await respuesta.json();

  verificar.equal(typeof creada.id, 'string');
  verificar.ok(creada.id.length > 0);
  verificar.equal(creada.clienteId, 'cliente-1');
  verificar.equal(creada.viajeId, 'viaje-1');
  verificar.equal(creada.conductorId, 'conductor-1');
  verificar.equal(creada.puntuacion, 5);
  verificar.equal(creada.comentario, 'Excelente conductor.');
  verificar.ok(Number.isFinite(Date.parse(creada.fechaCreacion)));
  verificar.equal(respuesta.headers.get('location'), `${ruta}/${creada.id}`);

  const consulta = await solicitar(`${ruta}/${creada.id}`);
  verificar.equal(consulta.status, 200);
  verificar.deepEqual(await consulta.json(), creada);

  const listado = await listar();
  verificar.deepEqual(listado.filter((c) => c.viajeId === 'viaje-1'), [creada]);
  verificar.ok(listado.every((c) => c.clienteId === 'cliente-1'));

  const repetida = await solicitar(ruta, 'POST', {
    ...datosValidos, puntuacion: 1
  });
  verificar.equal(repetida.status, 409);
  verificar.equal((await repetida.json()).codigo, 'CALIFICACION_DUPLICADA');
  verificar.deepEqual(await listar(), listado);
});

prueba('dos solicitudes simultáneas guardan una sola calificación', async () => {
  const respuestas = await Promise.all([
    solicitar(ruta, 'POST', { viajeId: 'viaje-5', puntuacion: 4 }),
    solicitar(ruta, 'POST', { viajeId: 'viaje-5', puntuacion: 4 })
  ]);
  const cuerpos = await Promise.all(respuestas.map((r) => r.json()));
  verificar.deepEqual(respuestas.map((r) => r.status).sort(), [201, 409]);

  const creada = cuerpos[respuestas.findIndex((r) => r.status === 201)];
  const error = cuerpos[respuestas.findIndex((r) => r.status === 409)];
  verificar.equal(error.codigo, 'CALIFICACION_DUPLICADA');
  verificar.equal(creada.clienteId, 'cliente-1');
  verificar.equal(creada.viajeId, 'viaje-5');
  verificar.equal(creada.conductorId, 'conductor-2');
  verificar.equal(creada.puntuacion, 4);
  verificar.equal(creada.comentario, null);
  verificar.deepEqual((await listar()).filter((c) => c.viajeId === 'viaje-5'), [creada]);
});

for (const [descripcion, viajeId, estado, codigo] of [
  ['un viaje en curso', 'viaje-2', 422, 'VIAJE_NO_COMPLETADO'],
  ['un viaje cancelado', 'viaje-3', 422, 'VIAJE_NO_COMPLETADO'],
  ['un viaje ajeno', 'viaje-4', 404, 'NO_ENCONTRADO'],
  ['un viaje inexistente', 'viaje-inexistente', 404, 'NO_ENCONTRADO']
] as const) {
  prueba(`E2E 2.4: rechaza ${descripcion} sin guardar datos`, async () => {
    const listadoInicial = await listar();
    const respuesta = await solicitar(ruta, 'POST', { ...datosValidos, viajeId });
    verificar.equal(respuesta.status, estado);
    verificar.equal((await respuesta.json()).codigo, codigo);
    verificar.deepEqual(await listar(), listadoInicial);
  });
}

prueba('rechaza puntuaciones inválidas y campos manipulados', async () => {
  const listadoInicial = await listar();
  const casosInvalidos = [
    ...[0, 6, 2.5, '5'].map((puntuacion) => ({ ...datosValidos, puntuacion })),
    { ...datosValidos, conductorId: 'conductor-falso' },
    { ...datosValidos, clienteId: 'cliente-2' },
    { ...datosValidos, comentario: 'a'.repeat(501) },
    { puntuacion: 5 }
  ];

  for (const cuerpo of casosInvalidos) {
    const respuesta = await solicitar(ruta, 'POST', cuerpo);
    verificar.equal(respuesta.status, 400);
    verificar.equal((await respuesta.json()).codigo, 'DATOS_INVALIDOS');
  }
  verificar.deepEqual(await listar(), listadoInicial);
});

prueba('la identidad simulada no puede operar como otro cliente', async () => {
  const listadoInicial = await listar();
  for (const metodo of ['GET', 'POST']) {
    const respuesta = await solicitar(
      '/clientes/cliente-2/calificaciones', metodo,
      metodo === 'POST' ? datosValidos : undefined
    );
    verificar.equal(respuesta.status, 403);
    verificar.equal((await respuesta.json()).codigo, 'ACCESO_DENEGADO');
  }
  verificar.deepEqual(await listar(), listadoInicial);
});

prueba('consultar una calificación inexistente devuelve 404', async () => {
  const respuesta = await solicitar(`${ruta}/calificacion-inexistente`);
  verificar.equal(respuesta.status, 404);
  verificar.equal((await respuesta.json()).codigo, 'NO_ENCONTRADO');
});