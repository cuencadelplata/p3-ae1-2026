import { writeFileSync } from 'node:fs';
import { buildOpenApiSpec } from '../src/docs/merged-openapi.js';

// Genera openapi.json en la raíz: src/docs/openapi.ts (RF-2.1/2.3/2.5) + docs/openapi.json (RF-2.2/2.4)
writeFileSync('openapi.json', JSON.stringify(buildOpenApiSpec(), null, 2) + '\n');
console.log('openapi.json generado');
