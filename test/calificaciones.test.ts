import { test as prueba } from 'node:test';
import type { TestContext } from 'node:test';
import verificar from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crearAplicacion } from '../src/app.js';
import { ServicioCalificaciones } from '../src/application/calificaciones-service.js';
import type { ConsultaViajes } from '../src/application/calificaciones-ports.js';
import { RepositorioSqlite } from '../src/infrastructure/sqlite-repository.js';
import { ViajesSimulados } from '../src/infrastructure/viajes-simulados.js';

const datosValidos = { viajeId: 'viaje-1', puntuacion: 5, comentario: 'Buen trato.' };

async function prepararAplicacion(contexto: TestContext, consultaViajes?: ConsultaViajes) {
  const repositorio = new RepositorioSqlite(':memory:');
  const servidor = crearAplicacion(repositorio, 'cliente-1', consultaViajes).listen(0, '127.0.0.1');

  contexto.after(async () => {
    try {
      await new Promise<void>((resolver, rechazar) => {
        servidor.close((error) => error ? rechazar(error) : resolver());
      });
    } finally {
      repositorio.cerrar();
    }
  });

  await once(servidor, 'listening');
  const direccion = servidor.address();
  if (!direccion || typeof direccion === 'string') throw new Error('Puerto no disponible.');
  const origen = `http://127.0.0.1:${direccion.port}`;
  return { repositorio, origen, url: `${origen}/clientes/cliente-1/calificaciones` };
}

function solicitar(url: string, cuerpo?: unknown) {
  return fetch(url, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(5000)
  });
}

prueba('POST califica un viaje completado; GET recupera y lista lo guardado', async (contexto) => {
  const { origen, url } = await prepararAplicacion(contexto);
  const respuesta = await solicitar(url, datosValidos);
  verificar.equal(respuesta.status, 201);
  const creada = await respuesta.json();
  verificar.equal(creada.clienteId, 'cliente-1');
  verificar.equal(creada.conductorId, 'conductor-1');
  verificar.equal(creada.viajeId, 'viaje-1');
  verificar.equal(creada.puntuacion, 5);
  verificar.equal(creada.comentario, 'Buen trato.');
  verificar.match(creada.id, /^[0-9a-f-]{36}$/);
  verificar.ok(Number.isFinite(Date.parse(creada.fechaCreacion)));
  verificar.equal(respuesta.headers.get('location'), `/clientes/cliente-1/calificaciones/${creada.id}`);
  const consulta = await solicitar(`${origen}${respuesta.headers.get('location')}`);
  verificar.equal(consulta.status, 200);
  verificar.deepEqual(await consulta.json(), creada);
  verificar.deepEqual(await (await solicitar(url)).json(), [creada]);
});

prueba('GET devuelve una lista vacía cuando no hay calificaciones', async (contexto) => {
  const { url } = await prepararAplicacion(contexto);
  const respuesta = await solicitar(url);
  verificar.equal(respuesta.status, 200);
  verificar.deepEqual(await respuesta.json(), []);
});

for (const [viajeId, estado, codigo] of [
  ['viaje-2', 422, 'VIAJE_NO_COMPLETADO'],
  ['viaje-3', 422, 'VIAJE_NO_COMPLETADO'],
  ['viaje-4', 404, 'NO_ENCONTRADO'],
  ['inexistente', 404, 'NO_ENCONTRADO']
] as const) {
  prueba(`POST rechaza ${viajeId} con ${estado} sin guardar datos`, async (contexto) => {
    const { url, repositorio } = await prepararAplicacion(contexto);
    const respuesta = await solicitar(url, { ...datosValidos, viajeId });
    verificar.equal(respuesta.status, estado);
    verificar.equal((await respuesta.json()).codigo, codigo);
    verificar.equal(repositorio.listarCalificaciones('cliente-1').length, 0);
  });
}

prueba('POST rechaza datos inválidos con el formato de errores de RF-2.2', async (contexto) => {
  const { url, repositorio } = await prepararAplicacion(contexto);
  const respuesta = await solicitar(url, { ...datosValidos, puntuacion: 8 });
  verificar.equal(respuesta.status, 400);
  const error = await respuesta.json();
  verificar.equal(error.codigo, 'DATOS_INVALIDOS');
  verificar.equal(typeof error.mensaje, 'string');
  verificar.equal(repositorio.listarCalificaciones('cliente-1').length, 0);
});

prueba('No se puede cambiar el conductor enviándolo en el cuerpo', async (contexto) => {
  const { url, repositorio } = await prepararAplicacion(contexto);
  const respuesta = await solicitar(url, { ...datosValidos, conductorId: 'otro-conductor' });
  verificar.equal(respuesta.status, 400);
  verificar.equal(repositorio.listarCalificaciones('cliente-1').length, 0);
});

prueba('El segundo POST del mismo viaje devuelve 409 y conserva la primera valoración', async (contexto) => {
  const { url } = await prepararAplicacion(contexto);
  const primera = await solicitar(url, datosValidos);
  verificar.equal(primera.status, 201);
  const creada = await primera.json();
  const repetida = await solicitar(url, { ...datosValidos, puntuacion: 1 });
  verificar.equal(repetida.status, 409);
  verificar.equal((await repetida.json()).codigo, 'CALIFICACION_DUPLICADA');
  verificar.deepEqual(await (await solicitar(url)).json(), [creada]);
});

prueba('Dos POST simultáneos producen una creación y un conflicto', async (contexto) => {
  const { url, repositorio } = await prepararAplicacion(contexto);
  const respuestas = await Promise.all([
    solicitar(url, datosValidos), solicitar(url, datosValidos)
  ]);
  verificar.deepEqual(respuestas.map((respuesta) => respuesta.status).sort(), [201, 409]);
  await Promise.all(respuestas.map((respuesta) => respuesta.json()));
  verificar.equal(repositorio.listarCalificaciones('cliente-1').length, 1);
});

prueba('El cliente puede calificar dos viajes distintos', async (contexto) => {
  const { url } = await prepararAplicacion(contexto);
  for (const viajeId of ['viaje-1', 'viaje-5']) {
    const respuesta = await solicitar(url, { ...datosValidos, viajeId });
    verificar.equal(respuesta.status, 201);
    await respuesta.json();
  }
  const lista = await (await solicitar(url)).json();
  verificar.equal(lista.length, 2);
  verificar.deepEqual(new Set(lista.map((dato: { viajeId: string }) => dato.viajeId)), new Set(['viaje-1', 'viaje-5']));
});

prueba('La identidad simulada bloquea GET y POST en la ruta de otro cliente', async (contexto) => {
  const { origen } = await prepararAplicacion(contexto);
  const ruta = `${origen}/clientes/cliente-2/calificaciones`;
  for (const cuerpo of [undefined, datosValidos]) {
    const respuesta = await solicitar(ruta, cuerpo);
    verificar.equal(respuesta.status, 403);
    verificar.equal((await respuesta.json()).codigo, 'ACCESO_DENEGADO');
  }
});

prueba('GET no expone calificaciones ajenas por id ni en el listado', async (contexto) => {
  const { url, repositorio } = await prepararAplicacion(contexto);
  const servicioAjeno = new ServicioCalificaciones(repositorio, new ViajesSimulados('cliente-2'));
  const ajena = await servicioAjeno.crearCalificacion('cliente-2', datosValidos);
  const respuesta = await solicitar(`${url}/${ajena.id}`);
  verificar.equal(respuesta.status, 404);
  verificar.equal((await respuesta.json()).codigo, 'NO_ENCONTRADO');
  verificar.deepEqual(await (await solicitar(url)).json(), []);
});

prueba('Si no se puede verificar el viaje, POST devuelve 503 sin guardar', async (contexto) => {
  const consultaViajes: ConsultaViajes = {
    async obtenerViaje() { throw new Error('Dependencia no disponible.'); }
  };
  const { url, repositorio } = await prepararAplicacion(contexto, consultaViajes);
  const respuesta = await solicitar(url, datosValidos);
  verificar.equal(respuesta.status, 503);
  verificar.equal((await respuesta.json()).codigo, 'VIAJES_NO_DISPONIBLE');
  verificar.equal(repositorio.listarCalificaciones('cliente-1').length, 0);
});

prueba('OpenAPI publica las rutas de RF-2.2 y RF-2.4; Swagger está disponible', async (contexto) => {
  const { origen } = await prepararAplicacion(contexto);
  const respuesta = await solicitar(`${origen}/openapi.json`);
  verificar.equal(respuesta.status, 200);
  const documento = await respuesta.json();
  verificar.ok(documento.paths['/clientes/{clienteId}/direcciones'].post);
  const ruta = documento.paths['/clientes/{clienteId}/calificaciones'];
  verificar.ok(ruta.post);
  verificar.ok(ruta.get);
  for (const estado of ['201', '400', '403', '404', '409', '422', '503']) {
    verificar.ok(ruta.post.responses[estado]);
  }
  verificar.equal(documento.components.schemas.DatosCalificacion.additionalProperties, false);
  const docs = await fetch(`${origen}/docs/`);
  verificar.equal(docs.status, 200);
  verificar.match(await docs.text(), /swagger-ui/i);
});

prueba('SQLite conserva la calificación y la unicidad después de reabrir la base', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'rf24-'));
  const archivo = join(carpeta, 'customer.sqlite');
  let repositorio: RepositorioSqlite | undefined;
  try {
    repositorio = new RepositorioSqlite(archivo);
    const servicio = new ServicioCalificaciones(repositorio, new ViajesSimulados());
    const creada = await servicio.crearCalificacion('cliente-1', datosValidos);
    repositorio.cerrar();
    repositorio = undefined;
    repositorio = new RepositorioSqlite(archivo);
    verificar.deepEqual(repositorio.obtenerCalificacion('cliente-1', creada.id), creada);
    const reiniciado = new ServicioCalificaciones(repositorio, new ViajesSimulados());
    await verificar.rejects(reiniciado.crearCalificacion('cliente-1', datosValidos), {
      estadoHttp: 409, codigo: 'CALIFICACION_DUPLICADA'
    });
  } finally {
    repositorio?.cerrar();
    rmSync(carpeta, { recursive: true, force: true });
  }
});