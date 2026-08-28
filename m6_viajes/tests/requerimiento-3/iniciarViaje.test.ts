import { describe, it, expect, beforeEach } from 'vitest';
import { solicitarViaje, asignarConductor, registrarArribo, iniciarViaje, resetViajesDb } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../fixtures/mocks.js';

describe('RF-6.3: Inicio Validado - Validacion con QR', () => {
  
  beforeEach(() => {
    resetViajesDb();
  });

  it('debe cambiar estado a EN_CURSO si el codigo es valido', () => {
    // Crear un viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    // Asignar conductor
    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    // Registrar arribo
    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    // Iniciar viaje con codigo valido
    const req4 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res4 = mockResponse();
    iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(200);
    expect(res4.data.viaje.estado).toBe('EN_CURSO');
  });

  it('debe rechazar si el codigo de verificacion es inválido', () => {
    // Crear un viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    // Asignar conductor
    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    // Registrar arribo
    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    // Intentar iniciar con codigo inválido
    const req4 = mockRequest({ codigoVerificacion: 'CODIGO_INVALIDO' }, { id: viajeId });
    const res4 = mockResponse();
    iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(401);
    expect(res4.data.error).toBe('Código de verificación inválido');
  });

  it('debe rechazar si el viaje no está en estado ARRIBADO', () => {
    // Crear un viaje sin asignar
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    // Intentar iniciar sin asignar conductor
    const req2 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res2 = mockResponse();
    iniciarViaje(req2 as any, res2 as any);

    expect(res2.statusCode).toBe(400);
    expect(res2.data.error).toContain('No puedes iniciar');
  });

  it('debe retornar 404 si el viaje no existe', () => {
    const req = mockRequest(
      { codigoVerificacion: 'ABC123' },
      { id: 'viaje-inexistente' }
    );
    const res = mockResponse();
    iniciarViaje(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.data.error).toBe('Viaje no encontrado');
  });

  it('debe validar codigo de forma case-sensitive', () => {
    // Crear un viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    // Asignar conductor
    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    // Registrar arribo
    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    // Intentar iniciar con codigo en minúscula (si el válido es mayúscula)
    const codigoIncorrecto = codigoValido.toLowerCase();
    const req4 = mockRequest({ codigoVerificacion: codigoIncorrecto }, { id: viajeId });
    const res4 = mockResponse();
    iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(401);
    expect(res4.data.error).toBe('Codigo de verificación invalido');
  });
});
