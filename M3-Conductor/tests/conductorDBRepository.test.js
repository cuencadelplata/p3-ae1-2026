const conductorDBRepository = require('../src/repositories/conductorDBRepository');
const getSupabaseClient = require('../src/config/SupabaseClient');

jest.mock('../src/config/SupabaseClient');

beforeEach(() => {
  jest.clearAllMocks();
  // Por defecto simulamos ambiente sin Supabase configurado (fallback en memoria)
  getSupabaseClient.mockReturnValue(null);
});

describe('conductorDBRepository (RF 3.1 - Persistencia y fallback en memoria)', () => {
  describe('obtenerHabilitadoPorId', () => {
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
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { usuario_id: 'cond_supa', habilitado: 'activo' },
          error: null
        })
      };
      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.obtenerHabilitadoPorId('cond_supa');

      expect(mockSupabase.from).toHaveBeenCalledWith('conductores');
      expect(mockSupabase.select).toHaveBeenCalledWith('usuario_id, habilitado');
      expect(mockSupabase.eq).toHaveBeenCalledWith('usuario_id', 'cond_supa');
      expect(resultado).toEqual({ usuarioID: 'cond_supa', habilitado: 'activo' });
    });
  });

  describe('actualizarHabilitado', () => {
    test('devuelve null si el conductor a actualizar no existe', async () => {
      const resultado = await conductorDBRepository.actualizarHabilitado('no_existe_999', 'activo');

      expect(resultado).toBeNull();
    });

    test('actualiza el estado de habilitación en memoria y retorna el estado anterior y nuevo', async () => {
      // Estado inicial conocido de cond_002
      const previo = await conductorDBRepository.obtenerHabilitadoPorId('cond_002');
      expect(previo).not.toBeNull();

      const nuevoEstado = previo.habilitado === 'activo' ? 'suspendido' : 'activo';
      const resultado = await conductorDBRepository.actualizarHabilitado('cond_002', nuevoEstado);

      expect(resultado).toEqual({
        usuarioID: 'cond_002',
        habilitado: nuevoEstado,
        habilitadoAnterior: previo.habilitado
      });

      // La lectura posterior debe reflejar el cambio en memoria
      const actualizado = await conductorDBRepository.obtenerHabilitadoPorId('cond_002');
      expect(actualizado.habilitado).toBe(nuevoEstado);
    });

    test('ejecuta update en Supabase cuando está configurado', async () => {
      const mockSupabase = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { usuario_id: 'cond_001', habilitado: 'activo' },
          error: null
        }),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockImplementation((col, val) => {
          if (mockSupabase.update.mock.calls.length > 0) {
            return Promise.resolve({ error: null });
          }
          return mockSupabase;
        })
      };
      getSupabaseClient.mockReturnValue(mockSupabase);

      const resultado = await conductorDBRepository.actualizarHabilitado('cond_001', 'rechazado');

      expect(resultado).toBeDefined();
      expect(resultado.habilitado).toBe('rechazado');
      expect(mockSupabase.from).toHaveBeenCalledWith('conductores');
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ habilitado: 'rechazado', updated_at: expect.any(String) })
      );
      expect(mockSupabase.eq).toHaveBeenCalledWith('usuario_id', 'cond_001');
    });
  });
});
