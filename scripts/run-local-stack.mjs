import { spawnSync } from 'node:child_process';

import {
  getLocalSupabaseCredentials,
  runSupabase,
  SUPABASE_EXCLUDED_SERVICES,
} from './lib/supabase-cli.mjs';

const action = process.argv[2];

const runDockerCompose = (args, environment = process.env) => {
  const result = spawnSync('docker', ['compose', ...args], {
    env: environment,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    throw new Error(`docker compose ${args.join(' ')} falló${detail}.`);
  }
};

const start = () => {
  console.log('Iniciando Supabase local...');
  runSupabase(['start', '--exclude', SUPABASE_EXCLUDED_SERVICES], { capture: true });
  const credentials = getLocalSupabaseCredentials();
  try {
    runDockerCompose(['up', '--build', '-d'], {
      ...process.env,
      SUPABASE_LOCAL_SERVICE_ROLE_KEY: credentials.serviceRoleKey,
    });
  } catch (error) {
    runSupabase(['stop']);
    throw error;
  }
  console.log('Entorno local iniciado: UI/API http://localhost:3000 y Supabase API http://localhost:54321.');
};

const stop = (clean) => {
  try {
    runDockerCompose(['down']);
  } finally {
    runSupabase(clean ? ['stop', '--no-backup'] : ['stop']);
  }
  console.log(clean ? 'Entorno local y datos temporales eliminados.' : 'Entorno local detenido.');
};

switch (action) {
  case 'up':
    start();
    break;
  case 'down':
    stop(false);
    break;
  case 'clean':
    stop(true);
    break;
  case 'reset':
    runSupabase(['db', 'reset']);
    console.log('Base local reconstruida desde migraciones y seed.');
    break;
  default:
    throw new Error('Acción inválida. Usá up, down, clean o reset.');
}
