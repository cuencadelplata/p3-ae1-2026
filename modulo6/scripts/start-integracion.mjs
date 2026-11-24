import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const composeFile = fileURLToPath(new URL('../../docker-compose.yml', import.meta.url));
const networkName = 'reservas-network';

function docker(args, stdio = 'inherit') {
  const result = spawnSync('docker', args, { cwd: repositoryRoot, stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} terminó con ${result.signal ?? result.status}`);
  }
}

try {
  docker(['info', '--format', '{{.Name}}']);
  const network = spawnSync('docker', ['network', 'inspect', networkName], { stdio: 'ignore' });
  if (network.error) throw network.error;
  if (network.status !== 0) {
    const created = spawnSync('docker', ['network', 'create', networkName], { stdio: 'inherit' });
    if (created.error) throw created.error;
    // Otra ejecución puede haber creado la misma red mientras se comprobaba.
    if (created.status !== 0) docker(['network', 'inspect', networkName], 'ignore');
  }

  const compose = ['compose', '-f', composeFile];
  docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '180', 'redis', 'rabbitmq']);
  docker([
    ...compose, 'up', '-d', '--build', '--wait', '--wait-timeout', '180',
    'm6-viajes', 'm6-cancelacion', 'm6-fachada',
  ]);
  console.log('M6 listo. Viajes :15000, Cancelaciones :15001, Fachada :15002 (puertos predeterminados).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
