import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openApiSpec } from './openapi.js';

type Spec = { paths: Record<string, unknown>; components: Record<string, Record<string, unknown>>; tags?: unknown[] };

/**
 * Contrato completo de M2: RF-2.1/2.3/2.5 (src/docs/openapi.ts) más RF-2.2/2.4
 * (docs/openapi.json). Las rutas de salud las define M2 una sola vez, y bearerAuth
 * es el JWT de M1 para todo el módulo.
 */
export function buildOpenApiSpec(): typeof openApiSpec {
  let ae2: Spec;
  try {
    ae2 = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'openapi.json'), 'utf8')) as Spec;
  } catch {
    return openApiSpec;
  }
  const base = openApiSpec as unknown as Spec;
  const ae2Paths = Object.fromEntries(Object.entries(ae2.paths).filter(([path]) => !path.startsWith('/health')));
  const components: Spec['components'] = { ...base.components };
  for (const [kind, entries] of Object.entries(ae2.components ?? {})) {
    components[kind] = { ...entries, ...(base.components[kind] ?? {}) };
  }
  return {
    ...openApiSpec,
    paths: { ...base.paths, ...ae2Paths },
    components,
    ...(ae2.tags ? { tags: ae2.tags } : {})
  } as unknown as typeof openApiSpec;
}
