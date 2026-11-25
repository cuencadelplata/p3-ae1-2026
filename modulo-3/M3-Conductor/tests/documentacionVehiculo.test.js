const { test, expect } = require('@playwright/test');
const path = require('path');
const { createMockFn, mockModule, clearModule, createRes } = require('./helpers/testUtils');

const SRC = path.join(__dirname, '..', 'src');
const redisRepoPath = path.join(SRC, 'repositories', 'redisRepository.js');
const eventPublisherPath = path.join(SRC, 'events', 'eventPublisher.js');
const m1ClientPath = path.join(SRC, 'infraestructure', 'm1Client.js');
const vehiculosClientPath = path.join(SRC, 'infraestructure', 'vehiculosClient.js');
const controllerPath = path.join(SRC, 'controllers', 'conductoresController.js');

const obtenerPendientes = createMockFn();
const obtenerDocumentacion = createMockFn();

mockModule(redisRepoPath, { obtenerPendientesDeHabilitacion: obtenerPendientes });
mockModule(eventPublisherPath, {
  publicarDriverAvailabilityUpdated: createMockFn(),
  publicarDriverStatusChanged: createMockFn(),
  publicar: createMockFn()
});
mockModule(m1ClientPath, { validarIdentidad: createMockFn() });
clearModule(vehiculosClientPath);
const { seleccionarDocumentacionVehiculo } = require(vehiculosClientPath);
mockModule(vehiculosClientPath, { obtenerDocumentacionVehiculo: obtenerDocumentacion, seleccionarDocumentacionVehiculo });
clearModule(controllerPath);

const { obtenerPendientesDeHabilitacion } = require(controllerPath);

test.afterAll(() => {
  clearModule(redisRepoPath);
  clearModule(eventPublisherPath);
  clearModule(m1ClientPath);
  clearModule(vehiculosClientPath);
  clearModule(controllerPath);
});

test('la solicitud pendiente lleva el vehículo y la cédula para soporte', async () => {
  obtenerPendientes.mockResolvedValue([
    { usuarioID: '42', createdAt: '2026-11-25T12:00:00.000Z', habilitado: 'pendiente' },
    { usuarioID: 'no-numerico', createdAt: '2026-11-25T12:00:00.000Z', habilitado: 'pendiente' }
  ]);
  obtenerDocumentacion.mockResolvedValue({
    vehiculo: { id: 'v1', patente: 'AA000AA', marca: 'Fiat', modelo: 'Cronos', anio: 2020, tipoServicio: 'AUTO' },
    documentacion: [{
      id: 'd1',
      tipoDocumento: 'CEDULA_VEHICULO',
      cara: 'FRENTE',
      numeroDocumento: 'ABC123',
      fechaVencimiento: '2030-01-01',
      estado: 'PENDIENTE',
      archivoUrl: 'data:image/jpeg;base64,abc'
    }]
  });

  const res = createRes();
  await obtenerPendientesDeHabilitacion({}, res);

  expect(res.status.calls[0][0]).toBe(200);
  expect(res.json.calls[0][0]).toEqual([{
    usuarioID: '42',
    createdAt: '2026-11-25T12:00:00.000Z',
    vehiculo: { id: 'v1', patente: 'AA000AA', marca: 'Fiat', modelo: 'Cronos', anio: 2020, tipoServicio: 'AUTO' },
    documentacionVehiculo: [{
      id: 'd1',
      tipoDocumento: 'CEDULA_VEHICULO',
      cara: 'FRENTE',
      numeroDocumento: 'ABC123',
      fechaVencimiento: '2030-01-01',
      estado: 'PENDIENTE',
      archivoUrl: 'data:image/jpeg;base64,abc'
    }]
  }]);
  expect(obtenerDocumentacion.calls.map((args) => args[0])).toEqual(['42']);
});

test('si m3-vehiculos no responde, la solicitud sigue llegando sin documentación', async () => {
  obtenerPendientes.mockResolvedValue([
    { usuarioID: '7', createdAt: '2026-11-25T12:00:00.000Z', habilitado: 'pendiente' }
  ]);
  obtenerDocumentacion.mockRejectedValue(new Error('m3-vehiculos no disponible'));

  const res = createRes();
  await obtenerPendientesDeHabilitacion({}, res);

  expect(res.json.calls[0][0]).toEqual([{
    usuarioID: '7',
    createdAt: '2026-11-25T12:00:00.000Z',
    vehiculo: null,
    documentacionVehiculo: []
  }]);
});

test('sin vehículo activo se envía el más reciente y su cédula', () => {
  const resultado = seleccionarDocumentacionVehiculo(
    [
      { id: 'viejo', patente: 'AAA111', marca: null, modelo: null, anio: 2010, tipoServicio: 'AUTO', activo: false, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'nuevo', patente: 'AA000AA', marca: 'Fiat', modelo: 'Cronos', anio: 2024, tipoServicio: 'AUTO', activo: false, createdAt: '2026-11-25T00:00:00.000Z' }
    ],
    [
      { id: 'cedula-vieja', tipoDocumento: 'CEDULA_VEHICULO', cara: 'FRENTE', numeroDocumento: '1', fechaVencimiento: '2030-01-01', estado: 'PENDIENTE', archivoUrl: 'data:image/jpeg;base64,a', vehicleId: 'viejo' },
      { id: 'cedula-nueva', tipoDocumento: 'CEDULA_VEHICULO', cara: 'DORSO', numeroDocumento: '2', fechaVencimiento: '2030-06-01', estado: 'PENDIENTE', archivoUrl: 'data:image/jpeg;base64,b', vehicleId: 'nuevo' }
    ]
  );

  expect(resultado.vehiculo.id).toBe('nuevo');
  expect(resultado.documentacion.map((documento) => documento.id)).toEqual(['cedula-nueva']);
});

test('se queda con el vehículo activo y solo con la documentación de ese vehículo', () => {
  const resultado = seleccionarDocumentacionVehiculo(
    [
      { id: 'viejo', patente: 'AAA111', marca: null, modelo: null, anio: 2010, tipoServicio: 'AUTO', activo: false },
      { id: 'activo', patente: 'AA000AA', marca: 'Fiat', modelo: 'Cronos', anio: 2020, tipoServicio: 'AUTO', activo: true }
    ],
    [
      { id: 'licencia', tipoDocumento: 'LICENCIA_CONDUCIR', cara: 'FRENTE', numeroDocumento: '1', fechaVencimiento: '2030-01-01', estado: 'PENDIENTE', archivoUrl: 'data:image/jpeg;base64,lic', vehicleId: null },
      { id: 'otra', tipoDocumento: 'CEDULA_VEHICULO', cara: 'FRENTE', numeroDocumento: '9', fechaVencimiento: new Date('2030-02-01'), estado: 'PENDIENTE', archivoUrl: 'data:image/jpeg;base64,otra', vehicleId: 'viejo' },
      { id: 'cedula', tipoDocumento: 'CEDULA_VEHICULO', cara: 'DORSO', numeroDocumento: '2', fechaVencimiento: '2030-03-01', estado: 'PENDIENTE', archivoUrl: 'data:image/jpeg;base64,ced', vehicleId: 'activo' }
    ]
  );

  expect(resultado.vehiculo).toMatchObject({ id: 'activo', patente: 'AA000AA' });
  expect(resultado.documentacion.map((documento) => documento.id)).toEqual(['licencia', 'cedula']);
  expect(resultado.documentacion[0].fechaVencimiento).toBe('2030-01-01');
  expect(resultado.documentacion[1].fechaVencimiento).toBe('2030-03-01');
});
