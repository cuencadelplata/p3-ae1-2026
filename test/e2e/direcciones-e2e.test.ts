import { test as prueba } from 'node:test';
import type { TestContext } from 'node:test';
import verificar from 'node:assert/strict';

const origen = process.env.API_URL;
if (!origen) throw new Error('Falta API_URL: indicá la URL de la API de pruebas.');
const ruta = '/clientes/cliente-1/direcciones';

const datosValidos = {
  alias: 'Casa',
  direccion: 'Av. 3 de Abril 1200',
  tipo: 'FAVORITA',
  uso: 'ORIGEN'
};

async function solicitar(destino: string, metodo = 'GET', cuerpo?: unknown) {
  return fetch(new URL(destino, origen), {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(5000)
  });
}

async function crearDireccion(contexto: TestContext, datos = datosValidos) {
  const respuesta = await solicitar(ruta, 'POST', datos);
  verificar.equal(respuesta.status, 201);
  const creada = await respuesta.json();
  verificar.equal(typeof creada.id, 'string');
  verificar.ok(creada.id.length > 0);

  contexto.after(async () => {
    const borrado = await solicitar(`${ruta}/${creada.id}`, 'DELETE');
    verificar.ok([204, 404].includes(borrado.status));
    await borrado.text();
  });

  verificar.equal(respuesta.headers.get('location'), `${ruta}/${creada.id}`);
  return creada;
}

prueba('crear, consultar, modificar y eliminar una dirección', async (contexto) => {
  const creada = await crearDireccion(contexto);
  for (const [campo, valor] of Object.entries(datosValidos)) {
    verificar.equal(creada[campo], valor);
  }
  verificar.equal(creada.clienteId, 'cliente-1');
  verificar.ok(Number.isFinite(Date.parse(creada.fechaCreacion)));

  const consulta = await solicitar(`${ruta}/${creada.id}`);
  verificar.equal(consulta.status, 200);
  verificar.deepEqual(await consulta.json(), creada);

  const cambios = {
    alias: 'Trabajo', direccion: 'Junín 500',
    tipo: 'RECIENTE', uso: 'DESTINO'
  };
  const modificacion = await solicitar(`${ruta}/${creada.id}`, 'PUT', cambios);
  verificar.equal(modificacion.status, 200);
  const actualizada = await modificacion.json();
  for (const [campo, valor] of Object.entries(cambios)) {
    verificar.equal(actualizada[campo], valor);
  }
  verificar.equal(actualizada.id, creada.id);
  verificar.equal(actualizada.clienteId, creada.clienteId);
  verificar.equal(actualizada.fechaCreacion, creada.fechaCreacion);

  const nuevaConsulta = await solicitar(`${ruta}/${creada.id}`);
  verificar.equal(nuevaConsulta.status, 200);
  verificar.deepEqual(await nuevaConsulta.json(), actualizada);

  const borrado = await solicitar(`${ruta}/${creada.id}`, 'DELETE');
  verificar.equal(borrado.status, 204);
  verificar.equal(await borrado.text(), '');

  const inexistente = await solicitar(`${ruta}/${creada.id}`);
  verificar.equal(inexistente.status, 404);
  verificar.equal((await inexistente.json()).codigo, 'NO_ENCONTRADO');
});

prueba('listar y filtrar favoritas y recientes', async (contexto) => {
  const favorita = await crearDireccion(contexto);
  const reciente = await crearDireccion(contexto, {
    ...datosValidos, tipo: 'RECIENTE', uso: 'DESTINO'
  });

  const listado = await solicitar(ruta);
  verificar.equal(listado.status, 200);
  const todas = await listado.json();
  verificar.ok(Array.isArray(todas));
  verificar.ok(todas.some((d) => d.id === favorita.id));
  verificar.ok(todas.some((d) => d.id === reciente.id));
  verificar.ok(todas.every((d) => d.clienteId === 'cliente-1'));

  for (const esperada of [favorita, reciente]) {
    const respuesta = await solicitar(`${ruta}?tipo=${esperada.tipo}`);
    verificar.equal(respuesta.status, 200);
    const filtradas = await respuesta.json();
    verificar.ok(Array.isArray(filtradas));
    verificar.ok(filtradas.some((d) => d.id === esperada.id));
    verificar.ok(filtradas.every((d) => d.tipo === esperada.tipo));
  }
});

prueba('datos inválidos no crean ni modifican direcciones', async (contexto) => {
  const creada = await crearDireccion(contexto);
  const antes = await solicitar(ruta);
  verificar.equal(antes.status, 200);
  const listadoInicial = await antes.json();

  for (const [metodo, destino] of [['POST', ruta], ['PUT', `${ruta}/${creada.id}`]]) {
    const respuesta = await solicitar(destino, metodo, { tipo: 'FAVORITA' });
    verificar.equal(respuesta.status, 400);
    verificar.equal((await respuesta.json()).codigo, 'DATOS_INVALIDOS');
  }

  const despues = await solicitar(ruta);
  verificar.equal(despues.status, 200);
  verificar.deepEqual(await despues.json(), listadoInicial);
});

prueba('la identidad simulada no puede operar como otro cliente', async () => {
  const rutaAjena = '/clientes/cliente-2/direcciones';
  for (const metodo of ['GET', 'POST', 'PUT', 'DELETE']) {
    const destino = ['PUT', 'DELETE'].includes(metodo)
      ? `${rutaAjena}/direccion-ajena` : rutaAjena;
    const cuerpo = ['POST', 'PUT'].includes(metodo) ? datosValidos : undefined;
    const respuesta = await solicitar(destino, metodo, cuerpo);
    verificar.equal(respuesta.status, 403);
    verificar.equal((await respuesta.json()).codigo, 'ACCESO_DENEGADO');
  }
});