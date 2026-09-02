import { spawnSync } from 'node:child_process';
import { request } from 'node:http';

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('No se pudo determinar la ruta del CLI de npm.');
}

const run = (command, args, environment = process.env) => {
  const result = spawnSync(command, args, {
    env: environment,
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    throw new Error(
      `${command} ${args.join(' ')} terminó con código ${result.status ?? 'desconocido'}${detail}.`,
    );
  }
};

const waitForHealth = async () => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const healthy = await new Promise((resolve) => {
        const healthRequest = request(
          'http://127.0.0.1:3909/health',
          { timeout: 2_000 },
          (response) => {
            response.resume();
            resolve(response.statusCode === 200);
          },
        );
        healthRequest.on('timeout', () => healthRequest.destroy());
        healthRequest.on('error', () => resolve(false));
        healthRequest.end();
      });
      if (healthy) return;
    } catch {
      // Compose todavía está iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('M9 no quedó saludable dentro de 60 segundos.');
};

let composeStarted = false;
try {
  const dockerEnvironment = {
    ...process.env,
    PORT: '3909',
    RESERVATION_JOB_INTERVAL: '*/1 * * * * *',
  };
  composeStarted = true;
  run('docker', ['compose', '--parallel', '1', 'up', '--build', '-d'], dockerEnvironment);
  await waitForHealth();
  run(
    'docker',
    ['compose', 'exec', '-T', 'm9-reservas', 'wget', '-qO-', 'http://m5-stub:3001/health'],
    dockerEnvironment,
  );
  run(
    'docker',
    ['compose', 'exec', '-T', 'm9-reservas', 'wget', '-qO-', 'http://m7-stub:3002/health'],
    dockerEnvironment,
  );
  run(process.execPath, [npmCli, 'run', 'test:e2e:only'], {
    ...process.env,
    E2E_BASE_URL: 'http://127.0.0.1:3909',
  });
} finally {
  if (composeStarted) {
    run('docker', ['compose', 'down']);
  }
}
