import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../app.js';
import { identityUnavailable, invalidToken } from '../errors/support-error.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import type { IdentityVerifier } from '../integrations/m1-identity.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

let verificar: ReturnType<typeof vi.fn<IdentityVerifier['verificar']>>;

function appCon(identityVerifier?: IdentityVerifier) {
  const ticketService = new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher());
  return createSupportApp({ ticketService, legacyEvents: false, identityVerifier });
}

beforeEach(() => {
  verificar = vi.fn<IdentityVerifier['verificar']>(async () => ({ userId: 1, role: 'CLIENTE' }));
});

describe('WWW-Authenticate en las respuestas 401', () => {
  const app = () => appCon({ verificar, isReachable: async () => true });

  it('401 SUPPORT_AUTH_REQUIRED lleva WWW-Authenticate: Bearer', async () => {
    const res = await request(app()).get('/tickets');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('401 SUPPORT_INVALID_TOKEN por formato lleva WWW-Authenticate: Bearer', async () => {
    const res = await request(app()).get('/tickets').set('Authorization', 'Basic no-es-bearer');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('401 SUPPORT_INVALID_TOKEN rechazado por M1 lleva WWW-Authenticate: Bearer', async () => {
    verificar.mockRejectedValueOnce(invalidToken());

    const res = await request(app()).get('/tickets').set('Authorization', 'Bearer x');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('las demás respuestas no la llevan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = await request(app()).get('/tickets').set('Authorization', 'Bearer x');
    verificar.mockRejectedValueOnce(identityUnavailable());
    const noDisponible = await request(app()).get('/tickets').set('Authorization', 'Bearer x');
    const sinAuth = await request(appCon()).post('/tickets').send({ tripId: 1 });

    expect(ok.status).toBe(200);
    expect(noDisponible.status).toBe(503);
    expect(sinAuth.status).toBe(400);
    for (const res of [ok, noDisponible, sinAuth]) {
      expect(res.headers['www-authenticate']).toBeUndefined();
    }
  });
});

describe('contrato OpenAPI: WWW-Authenticate', () => {
  it('la respuesta NoAutenticado declara la cabecera WWW-Authenticate: Bearer', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const YAML = (await import('yaml')).default;
    const contract = YAML.parse(fs.readFileSync(path.resolve(process.cwd(), '../../openapi/rf85-support.yaml'), 'utf8'));

    expect(contract.components.responses.NoAutenticado.headers['WWW-Authenticate'].$ref).toBe(
      '#/components/headers/WWW-Authenticate',
    );
    expect(contract.components.headers['WWW-Authenticate'].schema.enum).toEqual(['Bearer']);
  });
});
