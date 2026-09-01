import { crearAplicacion } from './app.js';
import { RepositorioSqlite } from './infrastructure/sqlite-repository.js';

const puerto = Number(process.env.PORT ?? '3000');

if (
  !Number.isInteger(puerto) ||
  puerto < 1 ||
  puerto > 65535
) {
  throw new Error(
    'PORT debe ser un número entero entre 1 y 65535.'
  );
}

const rutaArchivo = process.env.DB_PATH ?? './data/customer.sqlite';

const clienteSimulado = process.env.CLIENTE_SIMULADO ?? 'cliente-1';

const repositorio = new RepositorioSqlite(rutaArchivo);

const aplicacion = crearAplicacion(
  repositorio,
  clienteSimulado
);

const servidor = aplicacion.listen(
  puerto,
  '0.0.0.0',
  () => {
    console.log(
      `API de clientes disponible en http://localhost:${puerto}`
    );

    console.log(
      `Cliente simulado de AE1: ${clienteSimulado}`
    );
  }
);

servidor.on('error', (error) => {
  console.error(
    'No se pudo iniciar el servidor:',
    error.message
  );

  repositorio.cerrar();
  process.exitCode = 1;
});

// Cerrar la conexión a la base cuando detenemos el servidor.
let cierreSolicitado = false;

function cerrarServidor(): void {
  if (cierreSolicitado) {
    return;
  }

  cierreSolicitado = true;

  servidor.close(() => {
    repositorio.cerrar();
  });
}

process.once('SIGINT', cerrarServidor);
process.once('SIGTERM', cerrarServidor);