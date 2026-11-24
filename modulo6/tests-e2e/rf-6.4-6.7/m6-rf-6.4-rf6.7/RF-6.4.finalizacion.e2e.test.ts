import amqp from 'amqplib';
import { execFileSync } from 'node:child_process';
import { crearViaje, datosFinalizacion, post, prepararPago } from './helpers.js';

const rabbitUrl = process.env.E2E_RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672';

describe('RF-6.4 - Finalización del viaje en Docker', () => {
  it('registra tiempo real, distancia, tarifa y consulta el pago autorizado por M7', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-${Date.now()}`, iniciar: true });

    const { response, body } = await post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion());

    expect(response.status).toBe(200);
    expect(body.viaje).toMatchObject({
      estado: 'completado',
      // M7: (500 + 1,11 km × 250 + 1 min × 50) × 1 (auto)
      total: 827.5,
      tiempoMinutos: 1,
      tiempoEstimadoMinutos: 3,
      distanciaKm: 1.11,
      moneda: 'ARS',
      metricasEstimadas: true,
    });
    expect(body).toMatchObject({
      paymentId: `PAY-${viajeId}`,
      estadoPago: 'autorizado',
      fuenteMetrica: 'M4',
      idempotente: false,
    });
  });

  it.each(['efectivo', 'transferencia'])('finaliza con %s previamente autorizado por M7', async (tipo) => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-efectivo-${Date.now()}`, iniciar: true });

    await prepararPago(viajeId, tipo);
    const { response, body } = await post(
      `/api/viajes/${viajeId}/finalizacion`,
      datosFinalizacion({ metodoPago: tipo }),
    );

    expect(response.status).toBe(200);
    expect(body.estadoPago).toBe('autorizado');
  });

  it('rechaza finalizar un viaje que todavía no inició', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-no-iniciado-${Date.now()}` });

    const { response, body } = await post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion());

    expect(response.status).toBe(400);
    expect(body.error).toContain('estado SOLICITADO');
  });

  it('un segundo intento sobre un viaje ya completado devuelve la misma finalización sin cobrar de nuevo', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-doble-${Date.now()}`, iniciar: true });

    const primera = await post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion());
    const segunda = await post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion());

    expect(primera.response.status).toBe(200);
    expect(segunda.response.status).toBe(200);
    expect(segunda.body).toMatchObject({ idempotente: true, paymentId: primera.body.paymentId });
    // Si M6 hubiera vuelto a autorizar, M7 respondería 400 (orden ya procesada).
  });

  it('finalizaciones concurrentes: una sola transición a completado', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-carrera-${Date.now()}`, iniciar: true });

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion())),
    );

    expect(resultados.map(({ response }) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(resultados.filter(({ body }) => body.idempotente === false)).toHaveLength(1);
    const historial = await fetch(`${process.env.E2E_API_URL ?? 'http://127.0.0.1:3002'}/api/viajes/${viajeId}/historial-transiciones`);
    const { historial: transiciones } = await historial.json() as { historial: Array<{ to: string }> };
    expect(transiciones.filter((transicion) => transicion.to === 'completado')).toHaveLength(1);
  });

  it.each(['pendiente', 'rechazado'])('devuelve 402 si M7 informa %s y el viaje sigue en curso', async (estado) => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-rechazo-${Date.now()}`, iniciar: true });

    await prepararPago(viajeId, 'tarjeta', estado);
    const rechazo = await post(
      `/api/viajes/${viajeId}/finalizacion`,
      datosFinalizacion(),
    );

    expect(rechazo.response.status).toBe(402);
  });

  it('publica viaje.finalizado (M3) y trip.completed (M8) en RabbitMQ', async () => {
    const conexion = await amqp.connect(rabbitUrl);
    const canal = await conexion.createChannel();
    try {
      await canal.assertExchange('viajes.events', 'topic', { durable: true });
      await canal.assertExchange('mobility.events', 'topic', { durable: true });
      const colaM3 = (await canal.assertQueue('', { exclusive: true })).queue;
      const colaM8 = (await canal.assertQueue('', { exclusive: true })).queue;
      await canal.bindQueue(colaM3, 'viajes.events', 'viaje.finalizado');
      await canal.bindQueue(colaM8, 'mobility.events', 'trip.completed');

      // M8 identifica al destinatario con el userId numérico de M1.
      const clienteId = String(Date.now());
      const viajeId = await crearViaje({ clienteId, iniciar: true });
      const { response } = await post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion());
      expect(response.status).toBe(200);

      const esperarMensaje = async (cola: string) => {
        for (let intento = 0; intento < 40; intento += 1) {
          const mensaje = await canal.get(cola, { noAck: true });
          if (mensaje) {
            const payload = JSON.parse(mensaje.content.toString());
            if (JSON.stringify(payload).includes(viajeId)) return payload;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        throw new Error(`No llegó el evento del viaje ${viajeId} a ${cola}`);
      };

      expect(await esperarMensaje(colaM3)).toMatchObject({
        eventType: 'viaje.finalizado',
        data: { viajeId, clienteId, conductorId: `conductor-${clienteId}` },
      });
      expect(await esperarMensaje(colaM8)).toMatchObject({
        eventType: 'TripCompleted',
        version: 1,
        correlationId: viajeId,
        producer: 'm6-viajes',
        data: { tripId: viajeId, recipientId: Number(clienteId) },
      });
    } finally {
      await canal.close();
      await conexion.close();
    }
  });

  // Antes apagaba el contenedor `simulador`; ahora M4 es el proveedor de prueba m4-e2e-test.
  it('keeps API alive while M4 is stopped', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-outage-${Date.now()}`, iniciar: true });
    const compose = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.rf-e2e.yml'];

    execFileSync('docker', [...compose, 'stop', 'm4-e2e-test']);
    try {
      const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3002';
      let health: Response | undefined;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          health = await fetch(`${apiUrl}/health`);
          if (health.status === 200) break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(health?.status).toBe(200);

      const { response } = await post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion());
      expect(response.status).toBe(503);
      expect(await health?.json()).toEqual({ status: 'ok' });
    } finally {
      execFileSync('docker', [...compose, 'start', 'm4-e2e-test']);
    }
  });
});
