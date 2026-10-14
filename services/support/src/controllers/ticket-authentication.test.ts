import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { createSupportApp } from '../app.js';
import { identityUnavailable, invalidToken } from '../errors/support-error.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import type { IdentityVerifier } from '../integrations/m1-identity.js';
import type { TripVerifier } from '../integrations/m6-trips.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

const contract = YAML.parse(fs.readFileSync(path.resolve(process.cwd(), '../../openapi/rf85-support.yaml'), 'utf8'));

const TOKEN = 'Bearer token-valido';
const PEDIDO = { tripId: 'trip-1', motivo: 'Demora' };

let app: Express;
let verificar: ReturnType<typeof vi.fn<IdentityVerifier['verificar']>>;
let existe: ReturnType<typeof vi.fn<TripVerifier['existe']>>;

function appCon(identityVerifier?: IdentityVerifier) {
  const tripVerifier: TripVerifier = { existe, isReachable: async () => true };
  const ticketService = new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher(), tripVerifier);
  return createSupportApp({ ticketService, legacyEvents: true, identityVerifier });
}

beforeEach(() => {
  verificar = vi.fn<IdentityVerifier['verificar']>(async () => ({ userId: 42, role: 'CLIENTE' }));
  existe = vi.fn<TripVerifier['existe']>(async () => true);
  app = appCon({ verificar, isReachable: async () => true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Las cinco rutas de /tickets, con un pedido que sería válido.
const RUTAS: Array<[string, (a: Express) => request.Test]> = [
  ['POST /tickets', (a) => request(a).post('/tickets').send(PEDIDO)],
  ['GET /tickets', (a) => request(a).get('/tickets')],
  ['GET /tickets/:id', (a) => request(a).get('/tickets/x')],
  ['PATCH /tickets/:id/estado', (a) => request(a).patch('/tickets/x/estado').send({ estado: 'RESUELTO' })],
  ['GET /tickets/:id/historial', (a) => request(a).get('/tickets/x/historial')],
];

describe('autenticación con M1 habilitada: sin cabecera Authorization', () => {
  it.each(RUTAS)('%s responde 401 SUPPORT_AUTH_REQUIRED sin consultar a M1', async (_ruta, pedir) => {
    const res = await pedir(app);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'SUPPORT_AUTH_REQUIRED', message: 'Se requiere la cabecera Authorization: Bearer <token>.' },
      correlationId: res.headers['x-correlation-id'],
    });
    expect(verificar).not.toHaveBeenCalled();
  });

  it('no crea el ticket ni consulta a M6', async () => {
    await request(app).post('/tickets').send(PEDIDO);

    expect(existe).not.toHaveBeenCalled();
    expect((await request(app).get('/tickets').set('Authorization', TOKEN)).body).toEqual([]);
  });

  it('X-Actor-Id no reemplaza a la autenticación', async () => {
    const res = await request(app).post('/tickets').set('X-Actor-Id', 'agente/0042').send(PEDIDO);

    expect(res.status).toBe(401);
  });
});

describe('autenticación con M1 habilitada: token rechazado', () => {
  it.each(RUTAS)('%s responde 401 SUPPORT_INVALID_TOKEN si M1 no acepta el token', async (_ruta, pedir) => {
    verificar.mockRejectedValue(invalidToken());

    const res = await pedir(app).set('Authorization', 'Bearer token-vencido');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'SUPPORT_INVALID_TOKEN', message: 'El token de autenticación no es válido.' },
      correlationId: res.headers['x-correlation-id'],
    });
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it.each(['Basic no-es-bearer', 'Bearer', 'token-suelto', 'Bearer dos partes'])(
    'Authorization "%s" no es un Bearer: 401 SUPPORT_INVALID_TOKEN sin consultar a M1',
    async (authorization) => {
      const res = await request(app).get('/tickets').set('Authorization', authorization);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SUPPORT_INVALID_TOKEN');
      expect(verificar).not.toHaveBeenCalled();
    },
  );

  it('un token rechazado no crea el ticket ni consulta a M6', async () => {
    verificar.mockRejectedValueOnce(invalidToken());

    await request(app).post('/tickets').set('Authorization', 'Bearer token-vencido').send(PEDIDO);

    expect(existe).not.toHaveBeenCalled();
    expect((await request(app).get('/tickets').set('Authorization', TOKEN)).body).toEqual([]);
  });
});

describe('autenticación con M1 habilitada: M1 no disponible (falla cerrado)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    verificar.mockRejectedValue(identityUnavailable(new Error('connect ECONNREFUSED 10.0.0.7:3001')));
  });

  it.each(RUTAS)('%s responde 503 SUPPORT_IDENTITY_UNAVAILABLE con Retry-After', async (_ruta, pedir) => {
    const res = await pedir(app).set('Authorization', TOKEN);

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toEqual({
      error: {
        code: 'SUPPORT_IDENTITY_UNAVAILABLE',
        message: 'No fue posible validar la identidad en este momento. Reintentá en unos instantes.',
      },
      correlationId: res.headers['x-correlation-id'],
    });
  });

  it('no expone el detalle de la falla de M1 ni crea el ticket', async () => {
    const res = await request(app).post('/tickets').set('Authorization', TOKEN).send(PEDIDO);

    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.7/);
    expect(existe).not.toHaveBeenCalled();
  });
});

describe('autenticación con M1 habilitada: token válido', () => {
  it('reenvía a M1 la cabecera Authorization recibida', async () => {
    await request(app).get('/tickets').set('Authorization', TOKEN);

    expect(verificar).toHaveBeenCalledTimes(1);
    expect(verificar).toHaveBeenCalledWith(TOKEN);
  });

  it('crea el ticket y el historial registra al autor como m1:<userId>', async () => {
    const creado = await request(app).post('/tickets').set('Authorization', TOKEN).send(PEDIDO);
    const historial = await request(app).get(`/tickets/${creado.body.id}/historial`).set('Authorization', TOKEN);

    expect(creado.status).toBe(201);
    expect(historial.status).toBe(200);
    expect(historial.body).toMatchObject([{ estadoAnterior: null, estadoNuevo: 'ABIERTO', cambiadoPor: 'm1:42' }]);
  });

  it('X-Actor-Id se ignora: el autor es siempre el usuario de M1', async () => {
    const creado = await request(app)
      .post('/tickets')
      .set('Authorization', TOKEN)
      .set('X-Actor-Id', 'me-hago-pasar-por-otro')
      .send(PEDIDO);
    await request(app)
      .patch(`/tickets/${creado.body.id}/estado`)
      .set('Authorization', TOKEN)
      .set('X-Actor-Id', 'me-hago-pasar-por-otro')
      .send({ estado: 'EN_PROCESO' });

    const historial = await request(app).get(`/tickets/${creado.body.id}/historial`).set('Authorization', TOKEN);

    expect(historial.body.map((entrada: { cambiadoPor: string }) => entrada.cambiadoPor)).toEqual(['m1:42', 'm1:42']);
  });

  it('cada cambio de estado queda a nombre de quien lo hizo', async () => {
    const creado = await request(app).post('/tickets').set('Authorization', TOKEN).send(PEDIDO);
    verificar.mockResolvedValueOnce({ userId: 9, role: 'OPERADOR' });

    await request(app)
      .patch(`/tickets/${creado.body.id}/estado`)
      .set('Authorization', 'Bearer token-del-operador')
      .send({ estado: 'EN_PROCESO' });

    const historial = await request(app).get(`/tickets/${creado.body.id}/historial`).set('Authorization', TOKEN);
    expect(historial.body.map((entrada: { cambiadoPor: string }) => entrada.cambiadoPor)).toEqual(['m1:42', 'm1:9']);
  });

  it('se autentica antes de verificar el viaje: un viaje inexistente sigue dando 422', async () => {
    existe.mockResolvedValue(false);

    const res = await request(app).post('/tickets').set('Authorization', TOKEN).send(PEDIDO);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUPPORT_TRIP_NOT_FOUND');
    expect(verificar).toHaveBeenCalledTimes(1);
  });

  it('la respuesta lleva X-Correlation-Id también en los 401', async () => {
    const res = await request(app).get('/tickets').set('X-Correlation-Id', 'corr-401');

    expect(res.status).toBe(401);
    expect(res.headers['x-correlation-id']).toBe('corr-401');
  });
});

describe('alcance de la autenticación', () => {
  it('POST /events/publish (legacy AE1) y la documentación no exigen Bearer', async () => {
    const publish = await request(app).post('/events/publish').send({});
    const docs = await request(app).get('/openapi.json');
    const health = await request(app).get('/health/live');

    expect(publish.status).toBe(400);
    expect(docs.status).toBe(200);
    expect(health.status).toBe(200);
    expect(verificar).not.toHaveBeenCalled();
  });
});

describe('sin verificador de identidad (SUPPORT_M1_IDENTITY_URL sin definir)', () => {
  beforeEach(() => {
    app = appCon();
  });

  it('las rutas de /tickets no exigen Authorization, como antes', async () => {
    const creado = await request(app).post('/tickets').send(PEDIDO);

    expect(creado.status).toBe(201);
    expect((await request(app).get('/tickets')).status).toBe(200);
  });

  it('el autor sigue saliendo de X-Actor-Id', async () => {
    const creado = await request(app).post('/tickets').set('X-Actor-Id', 'agente/0042').send(PEDIDO);
    const historial = await request(app).get(`/tickets/${creado.body.id}/historial`);

    expect(historial.body[0].cambiadoPor).toBe('agente/0042');
  });

  it('una cabecera Authorization se ignora: no se consulta a M1', async () => {
    const res = await request(app).post('/tickets').set('Authorization', 'Bearer lo-que-sea').send(PEDIDO);

    expect(res.status).toBe(201);
    expect(verificar).not.toHaveBeenCalled();
  });
});

describe('contrato OpenAPI de la autenticación', () => {
  const operaciones = [
    contract.paths['/tickets'].post,
    contract.paths['/tickets'].get,
    contract.paths['/tickets/{id}'].get,
    contract.paths['/tickets/{id}/estado'].patch,
    contract.paths['/tickets/{id}/historial'].get,
  ];

  it('declara el esquema bearer y lo marca opcional en las rutas de /tickets', () => {
    expect(contract.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    for (const operacion of operaciones) {
      expect(operacion.security).toEqual([{}, { bearerAuth: [] }]);
    }
    expect(contract.paths['/events/publish'].post.security).toBeUndefined();
  });

  it('todas las rutas de /tickets documentan el 401 y un 503 con Retry-After', () => {
    for (const operacion of operaciones) {
      expect(operacion.responses['401'].$ref).toBe('#/components/responses/NoAutenticado');
      const noDisponible = contract.components.responses[operacion.responses['503'].$ref.split('/').pop()];
      expect(noDisponible.headers['Retry-After']).toBeDefined();
      expect(noDisponible.content['application/json'].examples.identidadNoDisponible.value.error.code).toBe(
        'SUPPORT_IDENTITY_UNAVAILABLE',
      );
    }
  });

  it('los ejemplos del 401 coinciden con las respuestas reales', async () => {
    const ejemplos = contract.components.responses.NoAutenticado.content['application/json'].examples;
    verificar.mockRejectedValueOnce(invalidToken());

    const sinCabecera = await request(app).get('/tickets');
    const rechazado = await request(app).get('/tickets').set('Authorization', TOKEN);

    expect(sinCabecera.body.error).toEqual(ejemplos.sinCabecera.value.error);
    expect(rechazado.body.error).toEqual(ejemplos.tokenInvalido.value.error);
  });
});
