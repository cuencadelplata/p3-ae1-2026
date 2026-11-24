const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  createMockFn,
  mockModule,
  clearModule,
  clearAllMocks
} = require('./helpers/testUtils');

const SRC = path.join(__dirname, '..', 'src');
const supabasePath = path.join(SRC, 'config', 'SupabaseClient.js');
const repoPath = path.join(SRC, 'repositories', 'conductorDBRepository.js');

const getSupabaseClient = createMockFn().mockReturnValue(null);
mockModule(supabasePath, getSupabaseClient);

clearModule(repoPath);
const conductorDBRepository = require('../src/repositories/conductorDBRepository');

// Sin datos mock sembrados: los conductores se dan de alta por el propio repositorio.
test.beforeAll(async () => {
  getSupabaseClient.mockReturnValue(null);
  await conductorDBRepository.crearConductor({ usuarioID: 'cond_001', ciudad: 'Corrientes', tipovehiculo: 'auto', habilitado: 'activo' });
  await conductorDBRepository.crearConductor({ usuarioID: 'cond_002', ciudad: 'Resistencia', tipovehiculo: 'moto', habilitado: 'activo' });
  await conductorDBRepository.crearConductor({ usuarioID: 'cond_003', ciudad: 'Posadas', tipovehiculo: 'auto' });
});

test.beforeEach(() => {
  clearAllMocks(getSupabaseClient);
  getSupabaseClient.mockReturnValue(null);
});

test.describe('conductorDBRepository.crearConductor', () => {
  test('da de alta en memoria con habilitado=pendiente por defecto', async () => {
    await conductorDBRepository.crearConductor({ usuarioID: 'cond_alta_1', ciudad: 'Posadas', tipovehiculo: 'moto' });
    expect(await conductorDBRepository.obtenerHabilitadoPorId('cond_alta_1')).toEqual({
      usuarioID: 'cond_alta_1',
      habilitado: 'pendiente'
    });
  });

  test('hace upsert en Supabase cuando está configurado', async () => {
    const upsert = createMockFn().mockResolvedValue({ error: null });
    const from = createMockFn().mockReturnValue({ upsert });
    getSupabaseClient.mockReturnValue({ from });

    await conductorDBRepository.crearConductor({ usuarioID: 'cond_alta_2', ciudad: 'Corrientes', tipovehiculo: 'auto' });

    expect(from.mock.calls[0]).toEqual(['conductores']);
    expect(upsert.mock.calls[0][0]).toMatchObject({ usuario_id: 'cond_alta_2', tipo_vehiculo: 'auto', habilitado: 'pendiente' });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'usuario_id' });
  });
});

test.describe('conductorDBRepository (RF 3.1 - Persistencia y fallback en memoria)', () => {
  test.describe('obtenerHabilitadoPorId', () => {
    test('devuelve el estado de habilitación para un conductor existente en memoria', async () => {
      const resultado = await conductorDBRepository.obtenerHabilitadoPorId('cond_001');

      expect(resultado).toBeDefined();
      expect(resultado.usuarioID).toBe('cond_001');
      expect(typeof resultado.habilitado).toBe('string');
    });

    test('devuelve null si el conductor no existe', async () => {
      const resultado = await conductorDBRepository.obtenerHabilitadoPorId('no_existe_999');

      expect(resultado).toBeNull();
    });

    test('consulta Supabase cuando el cliente está disponible', async () => {
      const mockSupabase = {
        from: createMockFn().mockReturnThis(),
        select: createMockFn().mockReturnThis(),
        eq: createMockFn().mockReturnThis(),
        maybeSingle: createMockFn().mockResolvedValue({
          data: { usuario_id: 'cond_supa', habilitado: 'activo' },
          error: null
        })
      };
      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.obtenerHabilitadoPorId('cond_supa');

      expect(mockSupabase.from.calls[0][0]).toBe('conductores');
      expect(mockSupabase.select.calls[0][0]).toBe('usuario_id, habilitado');
      expect(mockSupabase.eq.calls[0]).toEqual(['usuario_id', 'cond_supa']);
      expect(resultado).toEqual({ usuarioID: 'cond_supa', habilitado: 'activo' });
    });
  });

  test.describe('actualizarHabilitado', () => {
    test('devuelve null si el conductor a actualizar no existe', async () => {
      const resultado = await conductorDBRepository.actualizarHabilitado('no_existe_999', 'activo');

      expect(resultado).toBeNull();
    });

    test('actualiza el estado de habilitación en memoria y retorna el estado anterior y nuevo', async () => {
      const previo = await conductorDBRepository.obtenerHabilitadoPorId('cond_002');
      expect(previo).not.toBeNull();

      const nuevoEstado = previo.habilitado === 'activo' ? 'suspendido' : 'activo';
      const resultado = await conductorDBRepository.actualizarHabilitado('cond_002', nuevoEstado);

      expect(resultado).toEqual({
        usuarioID: 'cond_002',
        habilitado: nuevoEstado,
        habilitadoAnterior: previo.habilitado
      });

      const actualizado = await conductorDBRepository.obtenerHabilitadoPorId('cond_002');
      expect(actualizado.habilitado).toBe(nuevoEstado);
    });

    test('ejecuta update en Supabase cuando está configurado', async () => {
      const mockSupabase = {
        from: createMockFn().mockReturnThis(),
        select: createMockFn().mockReturnThis(),
        maybeSingle: createMockFn().mockResolvedValue({
          data: { usuario_id: 'cond_001', habilitado: 'activo' },
          error: null
        }),
        update: createMockFn().mockReturnThis(),
        eq: createMockFn()
      };

      mockSupabase.eq.mockImplementation(function eqImpl() {
        if (mockSupabase.update.calls.length > 0) {
          return Promise.resolve({ error: null });
        }
        return mockSupabase;
      });

      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.actualizarHabilitado('cond_001', 'rechazado');

      expect(resultado).toBeDefined();
      expect(resultado.habilitado).toBe('rechazado');
      expect(mockSupabase.from.calls.some((c) => c[0] === 'conductores')).toBe(true);
      expect(mockSupabase.update.calls[0][0]).toMatchObject({
        habilitado: 'rechazado'
      });
      expect(typeof mockSupabase.update.calls[0][0].updated_at).toBe('string');
      expect(mockSupabase.eq.calls.some((c) => c[0] === 'usuario_id' && c[1] === 'cond_001')).toBe(true);
    });
  });

  test.describe('obtenerDisponiblePorId', () => {
    test('devuelve la disponibilidad en memoria para un conductor existente', async () => {
      const resultado = await conductorDBRepository.obtenerDisponiblePorId('cond_001');

      expect(resultado).toBeDefined();
      expect(resultado.usuarioID).toBe('cond_001');
      expect(typeof resultado.disponible).toBe('boolean');
    });

    test('devuelve null si el conductor no existe en memoria', async () => {
      const resultado = await conductorDBRepository.obtenerDisponiblePorId('no_existe_999');

      expect(resultado).toBeNull();
    });

    test('consulta Supabase (select usuario_id, disponible) cuando el cliente está disponible', async () => {
      const mockSupabase = {
        from: createMockFn().mockReturnThis(),
        select: createMockFn().mockReturnThis(),
        eq: createMockFn().mockReturnThis(),
        maybeSingle: createMockFn().mockResolvedValue({
          data: { usuario_id: 'cond_supa_disp', disponible: true },
          error: null
        })
      };
      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.obtenerDisponiblePorId('cond_supa_disp');

      expect(mockSupabase.from.calls[0][0]).toBe('conductores');
      expect(mockSupabase.select.calls[0][0]).toBe('usuario_id, disponible');
      expect(mockSupabase.eq.calls[0]).toEqual(['usuario_id', 'cond_supa_disp']);
      expect(resultado).toEqual({ usuarioID: 'cond_supa_disp', disponible: true });
    });

    test('usa fallback a memoria cuando Supabase lanza error en obtenerDisponiblePorId', async () => {
      await conductorDBRepository.actualizarDisponible('cond_001', true);

      const mockSupabase = {
        from: createMockFn().mockReturnThis(),
        select: createMockFn().mockReturnThis(),
        eq: createMockFn().mockReturnThis(),
        maybeSingle: createMockFn().mockResolvedValue({
          data: null,
          error: new Error('Supabase select error')
        })
      };
      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.obtenerDisponiblePorId('cond_001');

      expect(resultado).toEqual({ usuarioID: 'cond_001', disponible: true });
    });
  });

  test.describe('actualizarDisponible', () => {
    test('actualiza la disponibilidad en memoria para un conductor existente e inexistente', async () => {
      const resExistente = await conductorDBRepository.actualizarDisponible('cond_002', true);
      expect(resExistente).toEqual({ usuarioID: 'cond_002', disponible: true });

      const leido = await conductorDBRepository.obtenerDisponiblePorId('cond_002');
      expect(leido).toEqual({ usuarioID: 'cond_002', disponible: true });

      const resInexistente = await conductorDBRepository.actualizarDisponible('no_existe_999', false);
      expect(resInexistente).toEqual({ usuarioID: 'no_existe_999', disponible: false });
      expect(await conductorDBRepository.obtenerDisponiblePorId('no_existe_999')).toBeNull();
    });

    test('ejecuta update (disponible, updated_at) en Supabase cuando el cliente está configurado', async () => {
      const mockSupabase = {
        from: createMockFn().mockReturnThis(),
        update: createMockFn().mockReturnThis(),
        eq: createMockFn().mockResolvedValue({ error: null })
      };
      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.actualizarDisponible('cond_001', false);

      expect(resultado).toEqual({ usuarioID: 'cond_001', disponible: false });
      expect(mockSupabase.from.calls[0][0]).toBe('conductores');
      expect(mockSupabase.update.calls[0][0]).toMatchObject({ disponible: false });
      expect(typeof mockSupabase.update.calls[0][0].updated_at).toBe('string');
      expect(mockSupabase.eq.calls[0]).toEqual(['usuario_id', 'cond_001']);
    });

    test('usa fallback a memoria cuando Supabase lanza error en actualizarDisponible', async () => {
      const mockSupabase = {
        from: createMockFn().mockReturnThis(),
        update: createMockFn().mockReturnThis(),
        eq: createMockFn().mockResolvedValue({ error: new Error('Supabase update error') })
      };
      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.actualizarDisponible('cond_003', true);

      expect(resultado).toEqual({ usuarioID: 'cond_003', disponible: true });

      getSupabaseClient.mockReturnValue(null);
      const enMemoria = await conductorDBRepository.obtenerDisponiblePorId('cond_003');
      expect(enMemoria).toEqual({ usuarioID: 'cond_003', disponible: true });
    });
  });
});
