import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(moduleRoot, '..');
// Prefijo de los archivos del módulo según git ls-files (por ejemplo "modulo8/").
// Se calcula a partir de la ubicación real para no depender del nombre de la carpeta.
const modulePrefix = `${relative(repositoryRoot, moduleRoot).split('\\').join('/')}/`;
const problems = [];

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

for (const file of tracked) {
  if (!file.startsWith(modulePrefix)) continue;
  if (/(^|\/)\.env($|\.(?!example$))|\.(pem|p12|pfx|key)$/i.test(file)) {
    problems.push(`${file}: archivo privado rastreado por Git`);
  }
}

const template = parse(readFileSync(join(moduleRoot, '.env.example')));
for (const [name, value] of Object.entries(template)) {
  if (/(PASSWORD|SECRET|TOKEN|API_KEY|RABBITMQ_URL|REMOTE_WRITE_URL)$/.test(name)
      || name === 'RABBITMQ_USER' || name === 'GRAFANA_CLOUD_USER') {
    if (value && !value.includes('replace-with-')) {
      problems.push(`.env.example: ${name} debe ser un marcador, no un valor utilizable`);
    }
  }
}

const excluded = new Set(['node_modules', 'dist', '.pnpm-store', 'coverage']);
const signatures = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|glpat-|AIza|sk_live_|xox[baprs]-)[A-Za-z0-9_-]{8,})/;
function inspect(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(item.name)) continue;
    const file = join(directory, item.name);
    if (item.isDirectory()) {
      inspect(file);
    } else if (item.isFile() && !/^\.env(?:\.|$)/.test(item.name) && statSync(file).size < 1024 * 1024) {
      const buffer = readFileSync(file);
      if (buffer.includes(0)) continue;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (signatures.test(lines[index])) {
          problems.push(`${relative(moduleRoot, file)}:${index + 1}: posible clave privada o token`);
        }
      }
    }
  }
}
inspect(moduleRoot);

const workflow = join(repositoryRoot, '.github/workflows/m8-ci.yml');
if (existsSync(workflow)) {
  const lines = readFileSync(workflow, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*([A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|RABBITMQ_URL)):\s*(\S+)/);
    if (match && !match[2].startsWith('${{')) {
      problems.push(`.github/workflows/m8-ci.yml:${index + 1}: ${match[1]} no debe tener un valor literal`);
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else {
  console.log('Configuración pública de M8: sin archivos privados rastreados ni firmas comunes de secretos.');
}
