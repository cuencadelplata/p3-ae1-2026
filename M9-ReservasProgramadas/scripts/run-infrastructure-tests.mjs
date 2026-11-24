import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('No se pudo determinar la ruta del CLI de npm.');
}

const composeProject = 'm9-infrastructure-tests-' + randomUUID().slice(0, 8);
const redisPort = process.env.INFRA_REDIS_PORT ?? '0';
const postgresPort = process.env.INFRA_POSTGRES_PORT ?? '0';
const rabbitMqPort = process.env.INFRA_RABBITMQ_PORT ?? '0';
const rabbitMqManagementPort = process.env.INFRA_RABBITMQ_MANAGEMENT_PORT ?? '0';
const compose = ['compose', '-p', composeProject];
const dockerEnvironment = {
  ...process.env,
  REDIS_PORT: redisPort,
  POSTGRES_PORT: postgresPort,
  POSTGRES_USER: 'm9',
  POSTGRES_PASSWORD: 'm9-local',
  POSTGRES_DB: 'm9_reservas',
  RABBITMQ_PORT: rabbitMqPort,
  RABBITMQ_MANAGEMENT_PORT: rabbitMqManagementPort,
  RABBITMQ_USER: 'm9',
  RABBITMQ_PASSWORD: 'm9-local',
};

const execute = (command, args, options = {}) =>
  spawnSync(command, args, {
    env: options.environment ?? process.env,
    stdio: options.stdio ?? 'inherit',
    shell: false,
    timeout: options.timeout,
  });

const run = (command, args, environment = process.env) => {
  const result = execute(command, args, { environment });

  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    throw new Error(
      `${command} ${args.join(' ')} terminó con código ${result.status ?? 'desconocido'}${detail}.`,
    );
  }
};

const waitForBackingServices = async () => {
  const deadline = Date.now() + 240000;
  let summary = '';
  while (Date.now() < deadline) {
    const result = execute('docker', [...compose, 'ps', '--format', 'json'], {
      environment: dockerEnvironment,
      stdio: 'pipe',
      timeout: 15000,
    });
    try {
      const output = result.stdout?.toString().trim() || '';
      const states = output.startsWith('[')
        ? JSON.parse(output)
        : output
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
      summary = states.map((row) => row.Service + ':' + row.State + '/' + row.Health).join(', ');
      if (
        ['postgres', 'redis', 'rabbitmq'].every((name) =>
          states.some(
            (row) => row.Service === name && row.State === 'running' && row.Health === 'healthy',
          ),
        )
      )
        return states;
    } catch {
      /* La salida puede estar incompleta mientras Docker inicia. */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('La infraestructura no alcanzo readiness en 240 segundos: ' + summary);
};

let cleanupRequired = false;
let ready = false;

try {
  cleanupRequired = true;
  run('docker', [...compose, 'up', '-d', 'postgres', 'redis', 'rabbitmq'], dockerEnvironment);
  const states = await waitForBackingServices();
  ready = true;
  const publishedPort = (service, target) => {
    const port = states
      .find((row) => row.Service === service)
      ?.Publishers?.find(
        (binding) => binding.TargetPort === target && binding.Protocol === 'tcp',
      )?.PublishedPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Puerto de prueba no disponible para ' + service);
    return port;
  };
  const actualRedisPort = publishedPort('redis', 6379);
  const databaseUrl =
    'postgresql://m9:m9-local@127.0.0.1:' +
    publishedPort('postgres', 5432) +
    '/m9_reservas?schema=public';
  const rabbitMqUrl = 'amqp://m9:m9-local@127.0.0.1:' + publishedPort('rabbitmq', 5672);
  run(process.execPath, [npmCli, 'run', 'db:migrate:deploy'], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  run(
    process.execPath,
    [
      npmCli,
      'run',
      process.argv.includes('--coverage') ? 'test:coverage:all' : 'test:infrastructure:only',
    ],
    {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://127.0.0.1:' + actualRedisPort,
      RABBITMQ_URL: rabbitMqUrl,
      M9_TEST_INFRA_PROJECT: composeProject,
    },
  );
} catch (error) {
  if (!ready)
    execute('docker', [...compose, 'logs', '--tail', '15', 'postgres', 'redis', 'rabbitmq'], {
      environment: dockerEnvironment,
    });
  throw error;
} finally {
  if (cleanupRequired) {
    run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], dockerEnvironment);
  }
}
