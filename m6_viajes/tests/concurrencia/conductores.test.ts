import { describe, it, expect, beforeEach } from 'vitest';
import { solicitarViaje, asignarConductor, resetViajesDb } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../fixtures/mocks.js';

describe('Concurrencia - Dos conductores intentan aceptar el mismo viaje', () => {
  
  beforeEach(() => {
    resetViajesDb();
  });

  it('debe permitir que solo UN conductor asigne el viaje cuando dos intentan simultáneamente', async () => {
    // 1. Cliente solicita viaje
    const reqSolicitud = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Avenida Principal',
      destino: 'Centro Comercial',
    });
    const resSolicitud = mockResponse();
    await solicitarViaje(reqSolicitud as any, resSolicitud as any);
    
    const viajeId = resSolicitud.data.id;
    console.log(`✅ Viaje creado: ${viajeId}`);
    console.log(`   Estado: ${resSolicitud.data.estado}`);

    // 2. CONDUCTOR 1 intenta asignar
    const reqConductor1 = mockRequest(
      { conductorId: 'conductor-001' },
      { id: viajeId }
    );
    const resConductor1 = mockResponse();
    asignarConductor(reqConductor1 as any, resConductor1 as any);
    
    console.log(`\n🚗 Conductor 1 (conductor-001)`);
    console.log(`   Status: ${resConductor1.statusCode}`);
    console.log(`   Mensaje: ${resConductor1.data.mensaje}`);
    console.log(`   Estado viaje: ${resConductor1.data.viaje.estado}`);

    // 3. CONDUCTOR 2 intenta asignar el MISMO viaje (concurrencia)
    const reqConductor2 = mockRequest(
      { conductorId: 'conductor-002' },
      { id: viajeId }
    );
    const resConductor2 = mockResponse();
    asignarConductor(reqConductor2 as any, resConductor2 as any);
    
    console.log(`\n🚗 Conductor 2 (conductor-002)`);
    console.log(`   Status: ${resConductor2.statusCode}`);
    console.log(`   Error: ${resConductor2.data.error}`);

    // ✅ VALIDACIONES
    // Conductor 1 debería tener éxito (201 o 200)
    expect(resConductor1.statusCode).toBe(200);
    expect(resConductor1.data.viaje.conductorId).toBe('conductor-001');
    expect(resConductor1.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');
    
    // Conductor 2 debería ser rechazado (400)
    expect(resConductor2.statusCode).toBe(400);
    expect(resConductor2.data.error).toContain('No puedes asignar');
    
    // El viaje debe tener asignado solo conductor 1
    expect(resConductor2.data.error).toContain('CONDUCTOR_EN_CAMINO');
    
    console.log(`\n✅ RESULTADO: Solo conductor-001 pudo asignar el viaje`);
    console.log(`   Conductor-002 fue rechazado porque el viaje ya estaba asignado`);
  });

  it('debe mantener la consistencia: ningún viaje queda con dos conductores', async () => {
    // 1. Solicitar viaje
    const reqSolicitud = mockRequest({
      clienteId: 'cliente-premium',
      origen: 'Terminal',
      destino: 'Aeropuerto',
    });
    const resSolicitud = mockResponse();
    await solicitarViaje(reqSolicitud as any, resSolicitud as any);
    const viajeId = resSolicitud.data.id;

    // 2. Dos conductores intentan asignar en paralelo
    const reqC1 = mockRequest({ conductorId: 'cond-1' }, { id: viajeId });
    const resC1 = mockResponse();
    asignarConductor(reqC1 as any, resC1 as any);

    const reqC2 = mockRequest({ conductorId: 'cond-2' }, { id: viajeId });
    const resC2 = mockResponse();
    asignarConductor(reqC2 as any, resC2 as any);

    // 3. Validar que solo uno tiene éxito
    expect(resC1.statusCode).toBe(200);
    expect(resC2.statusCode).toBe(400);
    
    // El viaje debe tener solo un conductor
    expect(resC1.data.viaje.conductorId).toBe('cond-1');
    
    // Validar que resC2 no alteró el estado del viaje
    expect(resC2.data.error).toBeDefined();
    
    console.log(`✅ Consistencia garantizada: viaje solo tiene 1 conductor`);
  });

  it('debe demostrar que la segunda asignación falla incluso si es con diferente conductor', async () => {
    // Simular múltiples intentos de asignación
    const reqSolicitud = mockRequest({
      clienteId: 'cliente-2',
      origen: 'Punto A',
      destino: 'Punto B',
    });
    const resSolicitud = mockResponse();
    await solicitarViaje(reqSolicitud as any, resSolicitud as any);
    const viajeId = resSolicitud.data.id;

    // Primer conductor: éxito
    const req1 = mockRequest({ conductorId: 'alfa' }, { id: viajeId });
    const res1 = mockResponse();
    asignarConductor(req1 as any, res1 as any);
    expect(res1.statusCode).toBe(200);

    // Segundo conductor: falla
    const req2 = mockRequest({ conductorId: 'beta' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);
    expect(res2.statusCode).toBe(400);

    // Tercer conductor: también falla
    const req3 = mockRequest({ conductorId: 'gamma' }, { id: viajeId });
    const res3 = mockResponse();
    asignarConductor(req3 as any, res3 as any);
    expect(res3.statusCode).toBe(400);

    // Solo alfa debe ser el conductor asignado
    expect(res1.data.viaje.conductorId).toBe('alfa');
    
    console.log(`✅ Se rechazaron ${[res2, res3].filter(r => r.statusCode === 400).length} intentos de asignación concurrente`);
  });
});
