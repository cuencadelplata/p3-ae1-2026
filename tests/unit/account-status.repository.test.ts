import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
const connect = vi.fn();
vi.mock('../../src/config/db.js', () => ({ pool: { query, connect } }));

const dbDown = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

// createPolicy guarda un circuito por dependencia en el proceso: cada test carga módulos nuevos
async function freshRepository() {
  vi.resetModules();
  const { AccountStatusRepository } = await import('../../src/repositories/account-status.repository.js');
  const { ServiceUnavailableError } = await import('../../src/errors/service-unavailable.error.js');
  return { repository: new AccountStatusRepository(), ServiceUnavailableError };
}

describe('AccountStatusRepository (C6 - circuit breaker de PostgreSQL)', () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockReset();
    vi.stubEnv('RESILIENCE_RETRY_ATTEMPTS', '0');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('con la base caída, las consultas de estado abren el circuito y dejan de llamar a la base', async () => {
    query.mockRejectedValue(dbDown);
    const { repository, ServiceUnavailableError } = await freshRepository();

    for (let i = 0; i < 3; i++) {
      await expect(repository.findAccountStatus('cust_a')).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
    expect(query).toHaveBeenCalledTimes(3);

    await expect(repository.findAccountStatus('cust_a')).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(query).toHaveBeenCalledTimes(3); // circuito abierto: no se intentó conectar
  });

  it('las escrituras de estado también cuentan para el circuito', async () => {
    connect.mockRejectedValue(dbDown);
    const { repository, ServiceUnavailableError } = await freshRepository();
    const dto = { status: 'INACTIVO', reason: 'Baja solicitada' } as const;

    for (let i = 0; i < 3; i++) {
      await expect(repository.updateAccountStatus('cust_a', dto)).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
    await expect(repository.updateAccountStatus('cust_a', dto)).rejects.toBeInstanceOf(ServiceUnavailableError);

    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('si el ROLLBACK falla por la conexión caída, se propaga el error original', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN') return {};
        if (sql === 'ROLLBACK') throw new Error('connection terminated');
        throw dbDown;
      }),
      release: vi.fn()
    };
    connect.mockResolvedValue(client);
    const { repository, ServiceUnavailableError } = await freshRepository();

    await expect(repository.updateAccountStatus('cust_a', { status: 'INACTIVO', reason: 'Baja solicitada' }))
      .rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(client.release).toHaveBeenCalled();
  });

  it('cliente inexistente → null y hace ROLLBACK', async () => {
    const client = {
      query: vi.fn(async (sql: string) => (sql.startsWith('UPDATE') ? { rowCount: 0, rows: [] } : {})),
      release: vi.fn()
    };
    connect.mockResolvedValue(client);
    const { repository } = await freshRepository();

    expect(await repository.updateAccountStatus('cust_x', { status: 'INACTIVO', reason: 'Baja solicitada' })).toBeNull();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
