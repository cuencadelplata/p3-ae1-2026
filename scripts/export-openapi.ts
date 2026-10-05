import { writeFileSync } from 'node:fs';
import { openApiSpec } from '../src/docs/openapi.js';

// Genera openapi.json en la raíz a partir de src/docs/openapi.ts (única fuente de verdad)
writeFileSync('openapi.json', JSON.stringify(openApiSpec, null, 2) + '\n');
console.log('openapi.json generado');
