import { spawnSync } from 'node:child_process';

import { connect as connectToRabbitMq } from 'amqplib';

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('No se pudo determinar la ruta del CLI de npm.');
}

const composeProject = 'm9-infrastructure-tests';
const redisPort = process.env.INFRA_REDIS_PORT ?? '46379';
const postgresPort = process.env.INFRA_POSTGRES_PORT ?? '45432';
const rabbitMqPort = process.env.INFRA_RABBITMQ_PORT ?? '45672';
const rabbitMqManagementPort = process.env.INFRA_RABBITMQ_MANAGEMENT_PORT ?? '45673';
const rabbitMqUrl = `amqp://m9:m9-local@127.0.0.1:${rabbitMqPort}`;
const databaseUrl = `postgresql://m9:m9-local@127.0.0.1:${postgresPort}/m9_reservas?schema=public`;
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

const isReady = (service, command) =>
  execute('docker', [...compose, 'exec', '-T', service, ...command], {
    environment: dockerEnvironment,
    stdio: 'ignore',
    timeout: 5_000,
  }).status === 0;

const acceptsAmqpConnections = async () => {
  let connection;

  try {
    connection = await connectToRabbitMq(rabbitMqUrl, { timeout: 5_000 });
    const channel = await connection.createConfirmChannel();
    await channel.close();
    await connection.close();
    return true;
  } catch {
    if (connection) {
      await connection.close().catch(() => undefined);
    }
    return false;
  }
};

const waitForBackingServices = async () => {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const redisReady = isReady('redis', ['redis-cli', 'ping']);
    const postgresReady = isReady('postgres', ['pg_isready', '-U', 'm9', '-d', 'm9_reservas']);
    const rabbitMqNodeReady = isReady('rabbitmq', ['rabbitmq-diagnostics', '-q', 'ping']);
    const rabbitMqReady = rabbitMqNodeReady && (await acceptsAmqpConnections());

    if (redisReady && postgresReady && rabbitMqReady) return;

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error('PostgreSQL, Redis y RabbitMQ no quedaron saludables dentro de 120 segundos.');
};

let cleanupRequired = false;

try {
  run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], dockerEnvironment);
  cleanupRequired = true;
  run('docker', [...compose, 'up', '-d', 'postgres', 'redis', 'rabbitmq'], dockerEnvironment);
  await waitForBackingServices();
  run(process.execPath, [npmCli, 'run', 'db:migrate:deploy'], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  run(process.execPath, [npmCli, 'run', 'test:infrastructure:only'], {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    RABBITMQ_URL: rabbitMqUrl,
  });
} finally {
  if (cleanupRequired) {
    run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], dockerEnvironment);
  }
}
