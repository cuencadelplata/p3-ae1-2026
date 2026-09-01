import { test as prueba } from 'node:test';
import type { TestContext } from 'node:test';
import verificar from 'node:assert/strict';

import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { crearAplicacion } from '../src/app.js';
import { ServicioClientes } from '../src/application/clientes-service.js';
import { RepositorioSqlite } from '../src/infrastructure/sqlite-repository.js';

const datosValidos = {
  alias: 'Casa',
  direccion: 'Av. 3 de Abril 1200',
  tipo: 'FAVORITA',
  uso: 'ORIGEN'
};

async function prepararAplicacion(contexto: TestContext) {
  const repositorio = new RepositorioSqlite(':memory:');
  const servicio = new ServicioClientes(repositorio);

  const servidor = crearAplicacion(repositorio).listen(
    0,
    '127.0.0.1'
  );

  contexto.after(async () => {
    try {
      await new Promise<void>((resolver, rechazar) => {
        servidor.close((error) => {
          if (error) {
            rechazar(error);
          } else {
            resolver();
          }
        });
      });
    } finally {
      repositorio.cerrar();
    }
  });

  await once(servidor, 'listening');

  const direccion = servidor.address();

  if (direccion === null || typeof direccion === 'string') {
    throw new Error('No se pudo obtener el puerto de prueba.');
  }

  const origen = `http://127.0.0.1:${direccion.port}`;

  return {
    origen,
    url: `${origen}/clientes/cliente-1/direcciones`,
    servicio
  };
}

function solicitar(
  url: string,
  metodo = 'GET',
  cuerpo?: unknown
) {
  return fetch(url, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json'
    },
    body: cuerpo === undefined
      ? undefined
      : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(5000)
  });
}

prueba('POST guarda una dirección y GET permite recuperarla', async (contexto) => {
  const { url } = await prepararAplicacion(contexto);

  const respuesta = await solicitar(
    url,
    'POST',
    datosValidos
  );

  verificar.equal(respuesta.status, 201);

  const creada = await respuesta.json();

  verificar.equal(typeof creada.id, 'string');
  verificar.ok(creada.id.length > 0);
  verificar.equal(creada.clienteId, 'cliente-1');
  verificar.equal(creada.alias, 'Casa');
  verificar.equal(creada.tipo, 'FAVORITA');

  verificar.ok(
    Number.isFinite(Date.parse(creada.fechaCreacion))
  );

  verificar.equal(
    respuesta.headers.get('location'),
    `/clientes/cliente-1/direcciones/${creada.id}`
  );

  const consulta = await solicitar(`${url}/${creada.id}`);

  verificar.equal(consulta.status, 200);
  verificar.deepEqual(await consulta.json(), creada);
});

prueba('GET lista solo las direcciones del cliente y filtra por tipo', async (contexto) => {
  const { url, servicio } = await prepararAplicacion(contexto);

  const favorita = servicio.crearDireccion(
    'cliente-1',
    datosValidos
  );

  const reciente = servicio.crearDireccion('cliente-1', {
    ...datosValidos,
    tipo: 'RECIENTE'
  });

  servicio.crearDireccion('cliente-2', datosValidos);

  const respuesta = await solicitar(url);

  verificar.equal(respuesta.status, 200);

  const todas = await respuesta.json();

  verificar.equal(todas.length, 2);

  verificar.ok(
    todas.every(
      (direccion: { clienteId: string }) =>
        direccion.clienteId === 'cliente-1'
    )
  );

  const filtros = [
    ['FAVORITA', favorita.id],
    ['RECIENTE', reciente.id]
  ];

  for (const [tipo, id] of filtros) {
    const filtrada = await solicitar(`${url}?tipo=${tipo}`);

    verificar.equal(filtrada.status, 200);

    const direcciones = await filtrada.json();

    verificar.equal(direcciones.length, 1);
    verificar.equal(direcciones[0].id, id);
  }
});

prueba('PUT actualiza la dirección conservando su identidad', async (contexto) => {
  const { url, servicio } = await prepararAplicacion(contexto);

  const creada = servicio.crearDireccion(
    'cliente-1',
    datosValidos
  );

  const respuesta = await solicitar(
    `${url}/${creada.id}`,
    'PUT',
    {
      alias: 'Trabajo',
      direccion: 'Junín 500',
      tipo: 'RECIENTE',
      uso: 'DESTINO'
    }
  );

  verificar.equal(respuesta.status, 200);

  const actualizada = await respuesta.json();

  verificar.equal(actualizada.id, creada.id);
  verificar.equal(actualizada.clienteId, creada.clienteId);

  verificar.equal(
    actualizada.fechaCreacion,
    creada.fechaCreacion
  );

  verificar.equal(actualizada.alias, 'Trabajo');
  verificar.equal(actualizada.direccion, 'Junín 500');
  verificar.equal(actualizada.tipo, 'RECIENTE');
  verificar.equal(actualizada.uso, 'DESTINO');

  const consulta = await solicitar(`${url}/${creada.id}`);

  verificar.equal(consulta.status, 200);
  verificar.deepEqual(await consulta.json(), actualizada);
});

prueba('DELETE elimina la dirección y luego GET devuelve 404', async (contexto) => {
  const { url, servicio } = await prepararAplicacion(contexto);

  const creada = servicio.crearDireccion(
    'cliente-1',
    datosValidos
  );

  const respuesta = await solicitar(
    `${url}/${creada.id}`,
    'DELETE'
  );

  verificar.equal(respuesta.status, 204);
  verificar.equal(await respuesta.text(), '');

  const consulta = await solicitar(`${url}/${creada.id}`);

  verificar.equal(consulta.status, 404);

  const listado = await solicitar(url);

  verificar.deepEqual(await listado.json(), []);
});

prueba('POST y PUT inválidos devuelven 400 sin modificar datos', async (contexto) => {
  const { url, servicio } = await prepararAplicacion(contexto);

  const creada = servicio.crearDireccion(
    'cliente-1',
    datosValidos
  );

  const operaciones = [
    ['POST', url],
    ['PUT', `${url}/${creada.id}`]
  ];

  for (const [metodo, destino] of operaciones) {
    const respuesta = await solicitar(
      destino,
      metodo,
      { tipo: 'FAVORITA' }
    );

    verificar.equal(respuesta.status, 400);

    const error = await respuesta.json();

    verificar.equal(error.codigo, 'DATOS_INVALIDOS');
  }

  verificar.deepEqual(
    servicio.listarDirecciones('cliente-1'),
    [creada]
  );
});

prueba('Un filtro desconocido devuelve 400', async (contexto) => {
  const { url } = await prepararAplicacion(contexto);

  const respuesta = await solicitar(`${url}?tipo=OTRA`);

  verificar.equal(respuesta.status, 400);

  const error = await respuesta.json();

  verificar.equal(error.codigo, 'DATOS_INVALIDOS');
});

prueba('Un JSON mal formado devuelve 400', async (contexto) => {
  const { url } = await prepararAplicacion(contexto);

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: '{',
    signal: AbortSignal.timeout(5000)
  });

  verificar.equal(respuesta.status, 400);

  const error = await respuesta.json();

  verificar.equal(error.codigo, 'JSON_INVALIDO');
});

prueba('La identidad simulada no puede usar la ruta de otro cliente', async (contexto) => {
  const { origen, servicio } = await prepararAplicacion(contexto);

  const ajena = servicio.crearDireccion(
    'cliente-2',
    datosValidos
  );

  const ruta = `${origen}/clientes/cliente-2/direcciones`;

  for (const metodo of ['GET', 'POST', 'PUT', 'DELETE']) {
    const destino = ['PUT', 'DELETE'].includes(metodo)
      ? `${ruta}/${ajena.id}`
      : ruta;

    const cuerpo = ['POST', 'PUT'].includes(metodo)
      ? datosValidos
      : undefined;

    const respuesta = await solicitar(
      destino,
      metodo,
      cuerpo
    );

    verificar.equal(respuesta.status, 403);

    const error = await respuesta.json();

    verificar.equal(error.codigo, 'ACCESO_DENEGADO');
  }

  verificar.deepEqual(
    servicio.listarDirecciones('cliente-2'),
    [ajena]
  );
});

for (const metodo of ['GET', 'PUT', 'DELETE']) {
  prueba(
    `${metodo} no permite acceder a una dirección ajena desde la ruta propia`,
    async (contexto) => {
      const { url, servicio } = await prepararAplicacion(contexto);

      const ajena = servicio.crearDireccion(
        'cliente-2',
        datosValidos
      );

      const cuerpo = metodo === 'PUT'
        ? datosValidos
        : undefined;

      const respuesta = await solicitar(
        `${url}/${ajena.id}`,
        metodo,
        cuerpo
      );

      verificar.equal(respuesta.status, 404);

      const error = await respuesta.json();

      verificar.equal(error.codigo, 'NO_ENCONTRADO');

      verificar.deepEqual(
        servicio.obtenerDireccion('cliente-2', ajena.id),
        ajena
      );

      verificar.deepEqual(
        servicio.listarDirecciones('cliente-1'),
        []
      );
    }
  );
}

prueba('SQLite conserva una dirección al cerrar y volver a abrir la base', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'rf22-'));
  const rutaArchivo = join(carpeta, 'clientes.sqlite');

  let repositorio = new RepositorioSqlite(rutaArchivo);
  let abierto = true;

  try {
    const servicio = new ServicioClientes(repositorio);

    const creada = servicio.crearDireccion(
      'cliente-1',
      datosValidos
    );

    repositorio.cerrar();
    abierto = false;

    repositorio = new RepositorioSqlite(rutaArchivo);
    abierto = true;

    verificar.deepEqual(
      repositorio.obtenerDireccion('cliente-1', creada.id),
      creada
    );
  } finally {
    if (abierto) {
      repositorio.cerrar();
    }

    rmSync(carpeta, {
      recursive: true,
      force: true
    });
  }
});