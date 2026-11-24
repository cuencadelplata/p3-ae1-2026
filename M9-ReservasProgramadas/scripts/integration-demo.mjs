import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const DEMO_CLIENT_ID = '99999999-9999-4999-8999-999999999999';
const directory = new URL('../.integration/', import.meta.url);
const authFile = new URL('demo-auth.json', directory);
const services = ['m9-reservas', 'm5-dispatch-service', 'm7-api'];

export const createDemoToken = (secret, now = Math.floor(Date.now() / 1000)) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: DEMO_CLIENT_ID, role: 'CLIENTE', iat: now, exp: now + 86400 })}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};

async function main() {
  const action = process.argv[2];
  const withM4 = process.argv.includes('--with-m4');
  const withObs = process.argv.includes('--with-obs');
  const buildTargets = withM4 ? [...services, 'm4-api'] : services;
  const targets = withObs ? [...buildTargets, 'alloy'] : buildTargets;
  if (!['up', 'stop', 'config'].includes(action)) throw new Error('Usar up, stop o config.');
  let secret;
  try {
    ({ secret } = JSON.parse(await readFile(authFile, 'utf8')));
    if (typeof secret !== 'string' || secret.length < 64)
      throw new Error('Credencial local inválida.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(directory, { recursive: true });
    secret = randomBytes(48).toString('hex');
    await writeFile(authFile, JSON.stringify({ secret }), { flag: 'wx', mode: 0o600 });
  }
  const args = [
    'compose',
    '-f',
    '../docker-compose.yml',
    '-f',
    'compose.integration.yml',
    ...(withObs ? ['-f', 'compose.integration.observability.yml'] : []),
  ];
  const run = async (command) => {
    const child = spawn('docker', [...args, '--parallel', '1', ...command], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit',
      env: {
        ...process.env,
        // Los includes se interpolan completos aunque solo arranquen M9/M5/M7.
        // Las claves auxiliares son privadas, reproducibles y distintas por servicio.
        ...Object.fromEntries(
          [
            'M8_POSTGRES_PASSWORD',
            'M8_NOTIFICATIONS_DB_PASSWORD',
            'M8_RECEIPTS_DB_PASSWORD',
            'M8_SUPPORT_DB_PASSWORD',
            'M8_DELIVERY_DB_PASSWORD',
          ].map((name) => [
            name,
            process.env[name] || createHmac('sha256', secret).update(name).digest('hex'),
          ]),
        ),
        JWT_SECRET: process.env.JWT_SECRET || secret,
        M9_DEMO_JWT_SECRET: secret,
        M9_DEMO_TOKEN: createDemoToken(secret),
        M9_DEMO_ROUTE_MODE: withM4 ? 'm4' : 'stub',
      },
      windowsHide: true,
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`Docker terminó con código ${code}.`);
  };
  if (action === 'stop') await run(['stop', ...targets]);
  if (action === 'config') await run(['config', '--quiet']);
  if (action === 'up') {
    // Un único servicio por build evita que Bake compile varios módulos a la vez.
    for (const service of buildTargets) await run(['build', service]);
    await run(['up', '--no-build', '-d', ...targets]);
    console.log(withM4 ? 'Ruta obtenida de M4.' : 'Ruta fija de demostración; M4 no se inicia.');
    if (withObs) console.log('Grafana Alloy activo (UI en http://localhost:12345, OTLP en :4318).');
    console.log(`Integración iniciada. Cliente de demostración: ${DEMO_CLIENT_ID}`);
    console.log('Ejecutar npm run integration:check para probar M9 → M7 y M9 → M5.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
