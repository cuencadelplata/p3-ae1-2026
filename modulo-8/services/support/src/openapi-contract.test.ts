import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { createSupportApp, SUPPORT_API_ROUTES } from './app.js';
import { SUPPORT_ERROR_CODES } from './errors/support-error.js';
import { NoopSupportEventPublisher } from './events/support-event-publisher.js';
import { InMemoryTicketRepository, TRANSICIONES_PERMITIDAS } from './models/ticket.model.js';
import { TicketService } from './services/ticket.service.js';

const CONTRACT_PATH = path.resolve(process.cwd(), '../../openapi/rf85-support.yaml');
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

type Json = Record<string, any>;

const contract: Json = YAML.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

function resolveRef(ref: string): unknown {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<any>((node, segment) => (node === undefined || node === null ? undefined : node[segment]), contract);
}

function deref<T = Json>(node: Json): T {
  return (typeof node?.$ref === 'string' ? resolveRef(node.$ref) : node) as T;
}

function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item) => collectRefs(item, refs));
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        refs.push(value);
      } else {
        collectRefs(value, refs);
      }
    }
  }
  return refs;
}

function documentedOperations(): Array<{ method: string; path: string; operation: Json }> {
  return Object.entries<Json>(contract.paths).flatMap(([routePath, item]) =>
    HTTP_METHODS.filter((method) => item[method]).map((method) => ({ method, path: routePath, operation: item[method] })),
  );
}

let app: Express;

beforeEach(() => {
  const ticketService = new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher());
  app = createSupportApp({ ticketService, legacyEvents: true });
});

describe('contrato OpenAPI de RF8.5 (openapi/rf85-support.yaml)', () => {
  it('es OpenAPI 3.0.x, versión 2.0.0', () => {
    expect(contract.openapi).toMatch(/^3\.0\.\d+$/);
    expect(contract.info.version).toBe('2.0.0');
  });

  it('documenta exactamente las rutas que registra la aplicación', () => {
    const documentadas = documentedOperations().map(({ method, path: routePath }) => `${method.toUpperCase()} ${routePath}`);
    const registradas = SUPPORT_API_ROUTES.map(
      ({ method, path: routePath }) => `${method.toUpperCase()} ${routePath.replace(/:([A-Za-z]+)/g, '{$1}')}`,
    );

    expect(documentadas.sort()).toEqual(registradas.sort());
  });

  it('cada operación documentada está realmente montada en la aplicación', async () => {
    for (const { method, path: routePath } of documentedOperations()) {
      const res = await (request(app) as any)[method](routePath.replace(/\{[^}]+\}/g, 'no-existe')).send({});

      // El 404 por defecto de Express no trae cuerpo de error de Support.
      const noMontada = res.status === 404 && !res.body?.error;
      expect(noMontada, `${method.toUpperCase()} ${routePath} no está montada`).toBe(false);
    }
  });

  it('no incluye /health: es un contrato operativo común de M8', () => {
    expect(Object.keys(contract.paths).filter((routePath) => routePath.startsWith('/health'))).toEqual([]);
  });

  it('todas las referencias $ref resuelven', () => {
    const refs = collectRefs(contract);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/'), `referencia externa no admitida: ${ref}`).toBe(true);
      expect(resolveRef(ref), `no resuelve: ${ref}`).toBeDefined();
    }
  });

  it('el enum de códigos de error coincide con SUPPORT_ERROR_CODES', () => {
    const documentados: string[] = contract.components.schemas.Error.properties.error.properties.code.enum;

    expect([...documentados].sort()).toEqual([...SUPPORT_ERROR_CODES].sort());
  });

  it('el enum de estados coincide con los estados del dominio', () => {
    expect([...contract.components.schemas.TicketStatus.enum].sort()).toEqual(Object.keys(TRANSICIONES_PERMITIDAS).sort());
  });

  it('toda operación acepta X-Correlation-Id y toda respuesta lo devuelve', () => {
    for (const { method, path: routePath, operation } of documentedOperations()) {
      const etiqueta = `${method.toUpperCase()} ${routePath}`;
      const parametros = (operation.parameters ?? []).map((p: Json) => deref(p));
      expect(
        parametros.some((p: Json) => p.in === 'header' && p.name === 'X-Correlation-Id' && p.required === false),
        `${etiqueta} no declara X-Correlation-Id`,
      ).toBe(true);

      for (const [status, response] of Object.entries<Json>(operation.responses)) {
        expect(deref(response).headers?.['X-Correlation-Id'], `${etiqueta} ${status} no devuelve X-Correlation-Id`).toBeDefined();
      }
    }
  });

  it('marca viajeId y POST /events/publish como deprecados', () => {
    expect(contract.components.schemas.NuevoTicket.properties.viajeId.deprecated).toBe(true);
    expect(contract.components.schemas.Ticket.properties.viajeId.deprecated).toBe(true);
    expect(contract.paths['/events/publish'].post.deprecated).toBe(true);
    expect(contract.paths['/events/publish'].post.tags).toEqual(['RF8.6 (legacy AE1)']);
  });

  it('documenta 503 SUPPORT_DB_UNAVAILABLE en todas las operaciones de tickets', () => {
    for (const { method, path: routePath, operation } of documentedOperations()) {
      if (routePath.startsWith('/tickets')) {
        expect(operation.responses['503'], `${method.toUpperCase()} ${routePath} sin 503`).toBeDefined();
      }
    }
  });
});

describe('el contrato describe las respuestas reales del servicio', () => {
  it('Ticket: mismos campos que devuelve POST /tickets', async () => {
    const res = await request(app).post('/tickets').send({ tripId: 'trip-1', motivo: 'Demora' });
    const schema = contract.components.schemas.Ticket;

    expect(Object.keys(res.body).sort()).toEqual(Object.keys(schema.properties).sort());
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(Object.keys(contract.components.examples.TicketAbierto.value).sort()).toEqual(Object.keys(res.body).sort());
  });

  it('TicketHistoryEntry: mismos campos que devuelve GET /tickets/:id/historial', async () => {
    const created = await request(app).post('/tickets').send({ tripId: 'trip-1', motivo: 'Demora' });
    const res = await request(app).get(`/tickets/${created.body.id}/historial`);
    const schema = contract.components.schemas.TicketHistoryEntry;

    expect(Object.keys(res.body[0]).sort()).toEqual(Object.keys(schema.properties).sort());
    const ejemplo = contract.paths['/tickets/{id}/historial'].get.responses['200'].content['application/json'].examples.historial.value[0];
    expect(Object.keys(ejemplo).sort()).toEqual(Object.keys(res.body[0]).sort());
  });

  it('Error: misma forma y un código del enum', async () => {
    const res = await request(app).post('/tickets').send({ tripId: 123 });
    const schema = contract.components.schemas.Error;

    expect(Object.keys(res.body).sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.properties.error.properties.code.enum).toContain(res.body.error.code);
    expect(Object.keys(res.body.error.details[0]).sort()).toEqual(
      Object.keys(contract.components.schemas.ErrorDetail.properties).sort(),
    );
  });

  it('los ejemplos de error usan códigos del catálogo', () => {
    const ejemplos = [
      ...Object.values<Json>(contract.components.responses),
      contract.paths['/tickets'].post.responses['409'],
      contract.paths['/tickets/{id}/estado'].patch.responses['409'],
    ].flatMap((response) => Object.values<Json>(response.content['application/json'].examples));

    expect(ejemplos.length).toBeGreaterThan(0);
    for (const ejemplo of ejemplos) {
      expect(SUPPORT_ERROR_CODES).toContain(ejemplo.value.error.code);
    }
  });
});

describe('documentación servida por la aplicación', () => {
  it('GET /openapi.yaml devuelve el fragment 2.0.0', async () => {
    const res = await request(app).get('/openapi.yaml');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/yaml');
    expect(YAML.parse(res.text).info.version).toBe('2.0.0');
  });

  it('GET /openapi.json devuelve el mismo contrato', async () => {
    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(contract);
  });

  it('GET /api-docs responde 200 con la referencia interactiva', async () => {
    const res = await request(app).get('/api-docs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
