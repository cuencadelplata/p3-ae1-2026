import { spawn } from 'node:child_process';

const projectName = 'm6-rf-e2e';
const networkName = `${projectName}_default`;
const qrKey = 'm6-rf-e2e-qr-secret';
const m7Key = 'm6-rf-e2e-m7-secret';
const ports = {
  viajes: process.env.M6_E2E_VIAJES_PORT ?? '13000',
  cancelacion: process.env.M6_E2E_CANCELACION_PORT ?? '13001',
  fachada: process.env.M6_E2E_FACHADA_PORT ?? '13002',
  postgres: process.env.M6_E2E_POSTGRES_PORT ?? '15432',
  redis: process.env.M6_E2E_REDIS_PORT ?? '16379',
  rabbitmq: process.env.M6_E2E_RABBITMQ_PORT ?? '15672',
  rabbitmqManagement: process.env.M6_E2E_RABBITMQ_MGMT_PORT ?? '25672',
  m8: process.env.M6_E2E_M8_PORT ?? '13103',
  m7: process.env.M6_E2E_M7_PORT ?? '13107',
};
const composeArgs = [
  '-p', projectName,
  '-f', 'docker-compose.yml',
  '-f', 'docker-compose.rf-e2e.yml',
];

const testEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: projectName,
  M6_NETWORK: networkName,
  M6_VIAJES_HOST_PORT: ports.viajes,
  M6_CANCELACION_HOST_PORT: ports.cancelacion,
  M6_FACHADA_HOST_PORT: ports.fachada,
  M6_TRIPDB_HOST_PORT: ports.postgres,
  M6_REDIS_HOST_PORT: ports.redis,
  M6_RABBITMQ_HOST_PORT: ports.rabbitmq,
  M6_RABBITMQ_MGMT_HOST_PORT: ports.rabbitmqManagement,
  M6_E2E_M8_PORT: ports.m8,
  M6_E2E_M7_PORT: ports.m7,
  M7_TEST_URL: `http://127.0.0.1:${ports.m7}`,
  DB_HOST: '127.0.0.1',
  DB_PORT: ports.postgres,
  DB_USER: 'm6',
  DB_PASSWORD: 'm6pass',
  DB_NAME: 'tripdb',
  REDIS_URL: `redis://127.0.0.1:${ports.redis}`,
  M7_URL: 'http://m7-e2e-test:3000',
  M7_API_KEY: m7Key,
  QR_INTERNAL_API_KEY: qrKey,
  M8_URL: `http://host.docker.internal:${ports.m8}`,
  M8_TEST_URL: `http://127.0.0.1:${ports.m8}`,
  M8_QR_API_KEY: qrKey,
  E2E_API_URL: `http://127.0.0.1:${ports.fachada}`,
  E2E_CANCELACION_URL: `http://127.0.0.1:${ports.cancelacion}`,
  RF6_API_URL: `http://127.0.0.1:${ports.viajes}`,
  E2E_RABBITMQ_URL: `amqp://guest:guest@127.0.0.1:${ports.rabbitmq}`,
  RABBITMQ_URL: `amqp://guest:guest@127.0.0.1:${ports.rabbitmq}`,
  BASE_URL: `http://127.0.0.1:${ports.viajes}`,
};

let activeChild;
let receivedSignal;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (receivedSignal) return;
    receivedSignal = signal;
    activeChild?.kill(signal);
  });
}

function run(command, args, env = process.env, allowAfterSignal = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    activeChild = child;
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0 && (!receivedSignal || allowAfterSignal)) resolve();
      else reject(new Error(`${command} ${args.join(' ')} terminó con ${signal ?? code ?? receivedSignal}`));
    });
  });
}

let failure;
try {
  const buildFlag = process.env.M6_E2E_NO_BUILD === '1' ? [] : ['--build'];
  await run('docker', ['compose', ...composeArgs, 'up', '-d', '--wait', ...buildFlag], testEnvironment);
  await run('npm', ['run', 'build'], testEnvironment);
  await run('npm', ['test'], testEnvironment);
  await run('npm', ['run', 'test:e2e'], testEnvironment);
  await run('npm', ['run', 'k6:smoke'], testEnvironment);
  await run('npm', ['run', 'k6:load'], testEnvironment);
  await run('npm', ['run', 'k6:stress'], testEnvironment);
} catch (error) {
  failure = error;
} finally {
  try {
    await run('docker', ['compose', ...composeArgs, 'down'], testEnvironment, true);
  } catch (error) {
    failure ??= error;
  }
}

if (failure) {
  console.error(failure);
  process.exitCode = receivedSignal === 'SIGINT' ? 130 : receivedSignal === 'SIGTERM' ? 143 : 1;
}