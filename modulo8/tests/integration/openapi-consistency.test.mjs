import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import YAML from 'yaml';

const contractDirectory = path.resolve(process.cwd(), 'openapi');
const readContract = (name) => YAML.parse(readFileSync(path.join(contractDirectory, name), 'utf8'));
const integrated = readContract('m8-openapi.yaml');
const methods = ['get', 'post', 'put', 'patch', 'delete'];

test('las rutas de los contratos detallados coinciden con el OpenAPI integrado', () => {
  for (const [name, prefix] of [
    ['qr.openapi.yaml', ''],
    ['receipts.openapi.yaml', '/api/v1'],
    ['rf85-support.yaml', ''],
    ['notification-delivery.openapi.yaml', ''],
  ]) {
    const detailed = readContract(name);
    for (const [route, pathItem] of Object.entries(detailed.paths)) {
      if (route.startsWith('/health')) continue;
      for (const method of methods) {
        if (!pathItem[method]) continue;
        const integratedRoute = `${prefix}${route}`;
        const actual = integrated.paths[integratedRoute]?.[method];
        assert.ok(actual, `${name}: falta ${method.toUpperCase()} ${integratedRoute} en M8`);
        assert.deepEqual(
          Object.keys(actual.responses).sort(),
          Object.keys(pathItem[method].responses).sort(),
          `${name}: respuestas distintas en ${method.toUpperCase()} ${integratedRoute}`,
        );
      }
    }
  }
});

test('todas las referencias internas del OpenAPI integrado resuelven', () => {
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        assert.ok(child.startsWith('#/'), `referencia externa: ${child}`);
        const target = child.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
        assert.notEqual(target.reduce((node, part) => node?.[part], integrated), undefined, `referencia rota: ${child}`);
      } else {
        visit(child);
      }
    }
  };
  visit(integrated);
});
