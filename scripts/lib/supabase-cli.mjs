import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const platformPackages = {
  darwin: {
    arm64: ['@supabase/cli-darwin-arm64'],
    x64: ['@supabase/cli-darwin-x64'],
  },
  linux: {
    arm64: ['@supabase/cli-linux-arm64', '@supabase/cli-linux-arm64-musl'],
    x64: ['@supabase/cli-linux-x64', '@supabase/cli-linux-x64-musl'],
  },
  win32: {
    arm64: ['@supabase/cli-windows-arm64'],
    x64: ['@supabase/cli-windows-x64'],
  },
};

export const SUPABASE_EXCLUDED_SERVICES =
  'gotrue,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';

export const resolveSupabaseCli = () => {
  const packages = platformPackages[process.platform]?.[process.arch];
  if (!packages) {
    throw new Error(`Supabase CLI no admite ${process.platform}/${process.arch}.`);
  }

  for (const packageName of packages) {
    try {
      const packageDirectory = path.dirname(require.resolve(`${packageName}/package.json`));
      return path.join(
        packageDirectory,
        'bin',
        process.platform === 'win32' ? 'supabase-go.exe' : 'supabase-go',
      );
    } catch {
      // Se prueba el siguiente paquete compatible, incluido musl en Linux.
    }
  }

  throw new Error('No se encontró el binario local de Supabase CLI. Ejecutá npm install.');
};

export const runSupabase = (args, options = {}) => {
  const capture = options.capture === true;
  const result = spawnSync(resolveSupabaseCli(), args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? 'sin detalle';
    throw new Error(`Supabase CLI ${args.join(' ')} falló: ${detail}`);
  }

  return capture ? result.stdout : '';
};

export const getLocalSupabaseCredentials = () => {
  const status = JSON.parse(runSupabase(['status', '-o', 'json'], { capture: true }));
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.service_role_key;

  if (typeof serviceRoleKey !== 'string' || serviceRoleKey.length === 0) {
    throw new Error('Supabase local no informó SERVICE_ROLE_KEY.');
  }

  return {
    apiUrl: 'http://host.docker.internal:54321',
    serviceRoleKey,
  };
};
