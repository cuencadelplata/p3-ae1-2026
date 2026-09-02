import express from 'express';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { SupportController } from './support.controller.js';

const app = express();
app.use(express.json());

app.post('/tickets', SupportController.crearTicket);
app.get('/tickets/:id', SupportController.obtenerTicket);
app.patch('/tickets/:id/estado', SupportController.actualizarEstado);
app.get('/tickets', SupportController.listarTodos);

describe('SupportController', () => {

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
  });
});
