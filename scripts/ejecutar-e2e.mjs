import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';

// Crear una carpeta temporal exclusiva para esta ejecución.
const carpeta = mkdtempSync(join(tmpdir(), 'clientes-e2e-'));
const origen = 'http://127.0.0.1:3000';

// Iniciar la aplicación con una base de datos temporal.
const servidor = spawn(process.execPath, ['dist/src/server.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '3000',
    CLIENTE_SIMULADO: 'cliente-1',
    DB_PATH: join(carpeta, 'clientes.sqlite')
  }
});

let errorServidor;

servidor.on('error', (error) => {
  errorServidor = error;
});

const finServidor = new Promise((resolver) => {
  servidor.once('close', resolver);
});

try {
  // Esperar hasta 30 segundos a que la API esté disponible.
  const limite = Date.now() + 30000;
  let disponible = false;

  while (Date.now() < limite) {
    if (errorServidor) {
      throw errorServidor;
    }

    if (
      servidor.exitCode !== null ||
      servidor.signalCode !== null
    ) {
      throw new Error(
        'La API se detuvo antes de ejecutar las pruebas.'
      );
    }

    try {
      const respuesta = await fetch(`${origen}/salud`, {
        signal: AbortSignal.timeout(1000)
      });

      disponible = respuesta.ok;
      await respuesta.text();

      if (disponible) {
        break;
      }
    } catch {
      // La API todavía puede estar iniciándose.
    }

    await esperar(100);
  }

  if (!disponible) {
    throw new Error('La API no estuvo lista en 30 segundos.');
  }

  const patron = process.argv[2] ?? 'dist/test/e2e/*.test.js';

  const pruebas = spawn(
    process.execPath,
    ['--test', patron],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        API_URL: origen
      }
    }
  );

  process.exitCode = await new Promise((resolver, rechazar) => {
    pruebas.once('error', rechazar);

    pruebas.once('close', (codigo) => {
      resolver(codigo ?? 1);
    });
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // Detener el servidor al finalizar las pruebas.
  servidor.kill('SIGTERM');

  const limiteCierre = setTimeout(() => {
    servidor.kill('SIGKILL');
  }, 5000);

  limiteCierre.unref();

  await finServidor;
  clearTimeout(limiteCierre);

  rmSync(carpeta, {
    recursive: true,
    force: true
  });
}