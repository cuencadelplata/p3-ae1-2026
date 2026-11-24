import { readFile } from 'node:fs/promises';
import { createDemoToken } from './integration-demo.mjs';
const { secret } = JSON.parse(
  await readFile(new URL('../.integration/demo-auth.json', import.meta.url), 'utf8'),
);
process.stdout.write(createDemoToken(secret) + '\n');
