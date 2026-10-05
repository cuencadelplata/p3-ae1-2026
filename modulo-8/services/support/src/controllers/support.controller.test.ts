import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, it, expect } from 'vitest';
import { createSupportApp } from '../app.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

// Cada test usa la aplicación real con un repositorio en memoria propio.
let app: Express;

beforeEach(() => {
  const ticketService = new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher());
  app = createSupportApp({ ticketService, legacyEvents: true });
});

describe('SupportController', () => {

  describe('GET /health', () => {
    it('debe devolver status 200 y OK', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
    });
  });

  describe('POST /tickets', () => {
    it('debe crear un ticket con status 201 si los datos son válidos', async () => {
      const res = await request(app)
        .post('/tickets')
        .send({ viajeId: 'viaje-test-1', motivo: 'Problema con la tarifa' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.viajeId).toBe('viaje-test-1');
      expect(res.body.motivo).toBe('Problema con la tarifa');
      expect(res.body.estado).toBe('ABIERTO');
    });

    it('debe devolver 400 si falta viajeId o motivo', async () => {
      const res = await request(app)
        .post('/tickets')
        .send({ motivo: 'Solo motivo sin viajeId' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /tickets/:id', () => {
    it('debe obtener el ticket por ID con status 200', async () => {
      const postRes = await request(app)
        .post('/tickets')
        .send({ viajeId: 'viaje-test-2', motivo: 'Cobro duplicado' });

      const ticketId = postRes.body.id;

      const res = await request(app).get(`/tickets/${ticketId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ticketId);
    });

    it('debe devolver 404 si el ticket no existe', async () => {
      const res = await request(app).get('/tickets/no-existe-123');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PATCH /tickets/:id/estado', () => {
    it('debe actualizar el estado del ticket a EN_PROCESO con status 200', async () => {
      const postRes = await request(app)
        .post('/tickets')
        .send({ viajeId: 'viaje-test-3', motivo: 'Demora' });

      const ticketId = postRes.body.id;

      const res = await request(app)
        .patch(`/tickets/${ticketId}/estado`)
        .send({ estado: 'EN_PROCESO' });

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('EN_PROCESO');
    });

    it('debe devolver 400 si el estado enviado no es válido', async () => {
      const postRes = await request(app)
        .post('/tickets')
        .send({ viajeId: 'viaje-test-4', motivo: 'Demora' });

      const ticketId = postRes.body.id;

      const res = await request(app)
        .patch(`/tickets/${ticketId}/estado`)
        .send({ estado: 'ESTADO_INVALIDO' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('debe devolver 404 si el ticket no existe', async () => {
      const res = await request(app)
        .patch('/tickets/inexistente/estado')
        .send({ estado: 'RESUELTO' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /tickets', () => {
    it('debe listar todos los tickets', async () => {
      const res = await request(app).get('/tickets');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('cada test parte de un repositorio vacío', async () => {
      const res = await request(app).get('/tickets');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /events/publish', () => {
    it('debe devolver 200 al publicar un evento', async () => {
      const res = await request(app)
        .post('/events/publish')
        .send({
          routingKey: 'viaje.completado',
          payload: { viajeId: 'v-100', importe: 1200 },
          count: 2
        });

      expect(res.status).toBe(200);
      expect(res.body.solicitados).toBe(2);
      expect(res.body.routingKey).toBe('viaje.completado');
    });

    it('debe devolver 400 si falta routingKey o payload', async () => {
      const res = await request(app)
        .post('/events/publish')
        .send({ routingKey: 'viaje.completado' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('createSupportApp', () => {
  it('GET /health conserva exactamente la forma de respuesta actual', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'timestamp', 'uptime']);
    expect(res.body.status).toBe('OK');
    expect(res.body.service).toBe('m8-soporte');
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    expect(typeof res.body.uptime).toBe('number');
  });
});
