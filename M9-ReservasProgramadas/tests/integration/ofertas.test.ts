import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CHOFERES_DEMO, createM5StubApp, type ChoferStub } from '../../src/stubs/m5/app.js';
import type { Oferta } from '../../src/stubs/m5/ofertas.js';

const reserva = () => ({
  id: randomUUID(),
  origen: 'Terminal',
  destino: 'Puerto',
  vehiculo: 'AUTO',
  fechaHoraProgramada: new Date(Date.now() + 3_600_000).toISOString(),
  criterioAsignacion: 'MEJOR_CALIFICACION',
});
const historial = async (app: ReturnType<typeof createM5StubApp>, id: string): Promise<Oferta[]> =>
  (await request(app).get(`/asignaciones/${id}/ofertas`)).body.ofertas as Oferta[];
const esperarOferta = async (app: ReturnType<typeof createM5StubApp>, id: string) => {
  for (let i = 0; i < 100; i++) {
    const pendiente = (await historial(app, id)).find((o) => o.estado === 'PENDIENTE');
    if (pendiente) return pendiente;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('No apareció la oferta pendiente');
};
const choferes = (): ChoferStub[] => CHOFERES_DEMO.map((c) => ({ ...c }));

describe('RF-9.7: ofertas y aceptación explícita en M5 simulado', () => {
  it('ofrece por valoración y asigna al siguiente si el mejor rechaza', async () => {
    const conductores = choferes();
    conductores[0]!.respuestaSimulada = 'RECHAZAR';
    const app = createM5StubApp(conductores);
    const r = reserva();
    const response = await request(app).put(`/asignaciones/${r.id}`).send({ reserva: r });
    expect(response.status).toBe(200);
    expect(response.body.asignacion.choferId).toBe(conductores[1]!.id);
    const ofertas = await historial(app, r.id);
    expect(ofertas.map((o) => o.choferId)).toEqual([conductores[0]!.id, conductores[1]!.id]);
    expect(ofertas.map((o) => o.estado)).toEqual(['RECHAZADA', 'ACEPTADA']);
    expect(response.body.asignacion.id).toBe(ofertas[1]!.id);
  });

  it('vence la oferta sin respuesta y continúa; no acepta respuestas tardías', async () => {
    const conductores = choferes();
    conductores[0]!.respuestaSimulada = 'SIN_RESPUESTA';
    const app = createM5StubApp(conductores, { plazoOfertaMs: 30, demoraRespuestaMs: 1 });
    const r = reserva();
    const response = await request(app).put(`/asignaciones/${r.id}`).send({ reserva: r });
    expect(response.body.asignacion.choferId).toBe(conductores[1]!.id);
    const ofertas = await historial(app, r.id);
    expect(ofertas.map((o) => o.estado)).toEqual(['VENCIDA', 'ACEPTADA']);
    expect(
      (
        await request(app)
          .post(`/ofertas/${ofertas[0]!.id}/respuesta`)
          .send({ choferId: conductores[0]!.id, decision: 'ACEPTAR' })
      ).status,
    ).toBe(409);
  });

  it('devuelve null cuando todos rechazan o vencen; cada reintento abre una ronda nueva', async () => {
    const conductores = choferes().map((c) => ({ ...c, respuestaSimulada: 'RECHAZAR' as const }));
    const app = createM5StubApp(conductores);
    const r = reserva();
    for (let i = 0; i < 2; i++) {
      expect(
        (await request(app).put(`/asignaciones/${r.id}`).send({ reserva: r })).body.asignacion,
      ).toBeNull();
    }
    const ofertas = await historial(app, r.id);
    expect(ofertas).toHaveLength(4);
    expect(new Set(ofertas.map((o) => o.rondaId)).size).toBe(2);
  });

  it('espera una decisión HTTP, rechaza otro chofer y confirma una sola respuesta concurrente', async () => {
    const app = createM5StubApp([{ ...CHOFERES_DEMO[0]!, respuestaSimulada: 'MANUAL' }], {
      plazoOfertaMs: 2000,
    });
    const r = reserva();
    const pendiente = request(app)
      .put(`/asignaciones/${r.id}`)
      .send({ reserva: r })
      .then((v) => v);
    const oferta = await esperarOferta(app, r.id);
    expect(
      (
        await request(app)
          .post(`/ofertas/${oferta.id}/respuesta`)
          .send({ choferId: randomUUID(), decision: 'ACEPTAR' })
      ).status,
    ).toBe(409);
    const respuestas = await Promise.all(
      ['ACEPTAR', 'RECHAZAR'].map((decision) =>
        request(app)
          .post(`/ofertas/${oferta.id}/respuesta`)
          .send({ choferId: oferta.choferId, decision }),
      ),
    );
    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    const result = await pendiente;
    const ganadora = respuestas.find((r) => r.status === 200)!;
    expect(result.body.asignacion !== null).toBe(ganadora.body.oferta.estado === 'ACEPTADA');
  });

  it('cancelar una ronda pendiente invalida la respuesta y libera el candidato', async () => {
    const app = createM5StubApp([{ ...CHOFERES_DEMO[0]!, respuestaSimulada: 'MANUAL' }], {
      plazoOfertaMs: 2000,
    });
    const r = reserva();
    const pendiente = request(app)
      .put(`/asignaciones/${r.id}`)
      .send({ reserva: r })
      .then((v) => v);
    const oferta = await esperarOferta(app, r.id);
    expect((await request(app).delete(`/asignaciones/${r.id}`)).status).toBe(204);
    expect((await pendiente).body.asignacion).toBeNull();
    expect(
      (
        await request(app)
          .post(`/ofertas/${oferta.id}/respuesta`)
          .send({ choferId: oferta.choferId, decision: 'ACEPTAR' })
      ).status,
    ).toBe(409);
    expect((await historial(app, r.id))[0]!.estado).toBe('CANCELADA');
  });

  it('editar durante una oferta invalida la anterior y exige otra aceptación', async () => {
    const app = createM5StubApp([{ ...CHOFERES_DEMO[0]!, respuestaSimulada: 'MANUAL' }], {
      plazoOfertaMs: 2000,
    });
    const r = reserva();
    const anterior = request(app)
      .put(`/asignaciones/${r.id}`)
      .send({ reserva: r })
      .then((v) => v);
    const oferta = await esperarOferta(app, r.id);
    const nueva = request(app)
      .put(`/asignaciones/${r.id}`)
      .send({ reserva: { ...r, destino: 'Aeropuerto' } })
      .then((v) => v);
    await anterior;
    const vigente = await esperarOferta(app, r.id);
    expect(vigente.id).not.toBe(oferta.id);
    expect(
      (
        await request(app)
          .post(`/ofertas/${oferta.id}/respuesta`)
          .send({ choferId: oferta.choferId, decision: 'ACEPTAR' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/ofertas/${vigente.id}/respuesta`)
          .send({ choferId: vigente.choferId, decision: 'ACEPTAR' })
      ).status,
    ).toBe(200);
    expect((await nueva).body.asignacion.id).toBe(vigente.id);
  });

  it('dos PUT iguales comparten ronda y una asignación confirmada se devuelve sin nueva oferta', async () => {
    const app = createM5StubApp();
    const r = reserva();
    const respuestas = await Promise.all(
      [1, 2].map(() => request(app).put(`/asignaciones/${r.id}`).send({ reserva: r })),
    );
    expect(respuestas[0]!.body).toEqual(respuestas[1]!.body);
    await request(app).put(`/asignaciones/${r.id}`).send({ reserva: r });
    expect(await historial(app, r.id)).toHaveLength(1);
  });

  it('no ofrece el mismo chofer a dos viajes solapados ni lo confirma dos veces', async () => {
    const app = createM5StubApp([CHOFERES_DEMO[0]!]);
    const a = reserva(),
      b = { ...reserva(), fechaHoraProgramada: a.fechaHoraProgramada };
    const respuestas = await Promise.all(
      [a, b].map((r) => request(app).put(`/asignaciones/${r.id}`).send({ reserva: r })),
    );
    expect(respuestas.filter((r) => r.body.asignacion !== null)).toHaveLength(1);
  });

  it('rechaza criterios no admitidos y respuestas mal formadas', async () => {
    const app = createM5StubApp();
    const r = reserva();
    expect(
      (
        await request(app)
          .put(`/asignaciones/${r.id}`)
          .send({ reserva: { ...r, criterioAsignacion: 'OTRO' } })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post('/ofertas/inexistente/respuesta').send({ decision: 'SI' })).status,
    ).toBe(400);
    expect(() => createM5StubApp([], { plazoOfertaMs: 0 })).toThrow();
  });
});
