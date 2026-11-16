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

test.beforeEach(() => {
  clearAllMocks(getSupabaseClient);
  getSupabaseClient.mockReturnValue(null);
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
});
