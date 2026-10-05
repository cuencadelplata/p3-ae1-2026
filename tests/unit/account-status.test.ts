import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { calcularEstadoAutomatico, AccountStatusService } from '../../src/services/account-status.service.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import type { AccountStatusResponse } from '../../src/types/customer.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function savedStatus(overrides: Partial<AccountStatusResponse> = {}): AccountStatusResponse {
  return {
    customerId: 'cust_abc',
    status: 'ACTIVO',
    reason: 'Perfil verificado y sin infracciones operativas',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides
  };
}

// Repositorio mínimo que podemos mockear por método
function makeRepo(statusRow: AccountStatusResponse | null = savedStatus()) {
  return {
    findAccountStatus: vi.fn().mockResolvedValue(statusRow),
    updateAccountStatus: vi.fn().mockImplementation(async (_id: string, dto: any) =>
      savedStatus({ status: dto.status, reason: dto.reason, blockOrigin: dto.blockOrigin })
    )
  } as any;
}

function makeSoporte(total: number) {
  return {
    getPenalizaciones: vi.fn().mockResolvedValue({ userId: 12, total, penalizaciones: [] })
  } as any;
}

function makeSoporteCaido() {
  return {
    getPenalizaciones: vi.fn().mockRejectedValue(new ServiceUnavailableError('Soporte caído'))
  } as any;
}
// ─── Umbrales puros ───────────────────────────────────────────────────────────

describe('calcularEstadoAutomatico — umbrales de penalizaciones', () => {
  afterEach(() => {
    delete process.env.PENALIZACIONES_TEMPORAL;
    delete process.env.PENALIZACIONES_PERMANENTE;
  });

  it('0 penalizaciones → null (sin cambio)', () => {
    expect(calcularEstadoAutomatico(0)).toBeNull();
  });

  it('1 penalización → null (por debajo del umbral temporal por defecto de 2)', () => {
    expect(calcularEstadoAutomatico(1)).toBeNull();
  });

  it('2 penalizaciones → BLOQUEADO_TEMPORAL (umbral temporal por defecto)', () => {
    expect(calcularEstadoAutomatico(2)).toBe('BLOQUEADO_TEMPORAL');
  });

  it('3 penalizaciones → BLOQUEADO_PERMANENTE (umbral permanente por defecto)', () => {
    expect(calcularEstadoAutomatico(3)).toBe('BLOQUEADO_PERMANENTE');
  });

  it('10 penalizaciones → BLOQUEADO_PERMANENTE', () => {
    expect(calcularEstadoAutomatico(10)).toBe('BLOQUEADO_PERMANENTE');
  });

  it('respeta PENALIZACIONES_TEMPORAL=3 y PENALIZACIONES_PERMANENTE=5 por env', () => {
    process.env.PENALIZACIONES_TEMPORAL   = '3';
    process.env.PENALIZACIONES_PERMANENTE = '5';
    expect(calcularEstadoAutomatico(2)).toBeNull();
    expect(calcularEstadoAutomatico(3)).toBe('BLOQUEADO_TEMPORAL');
    expect(calcularEstadoAutomatico(4)).toBe('BLOQUEADO_TEMPORAL');
    expect(calcularEstadoAutomatico(5)).toBe('BLOQUEADO_PERMANENTE');
  });
});

// ─── AccountStatusService.getAccountStatus ────────────────────────────────────

describe('AccountStatusService.getAccountStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cliente inexistente → null', async () => {
    const svc = new AccountStatusService(makeRepo(null), makeSoporte(0));
    const result = await svc.getAccountStatus('cust_xyz', 99);
    expect(result).toBeNull();
  });

  it('0 penalizaciones, estado ACTIVO → devuelve el estado guardado sin persistir', async () => {
    const repo = makeRepo(savedStatus({ status: 'ACTIVO' }));
    const svc = new AccountStatusService(repo, makeSoporte(0));
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('ACTIVO');
    expect(repo.updateAccountStatus).not.toHaveBeenCalled();
  });

  it('2 penalizaciones → aplica BLOQUEADO_TEMPORAL y persiste', async () => {
    const repo = makeRepo(savedStatus({ status: 'ACTIVO' }));
    const svc = new AccountStatusService(repo, makeSoporte(2));
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('BLOQUEADO_TEMPORAL');
    expect(result?.blockOrigin).toBe('AUTOMATICO');
    expect(repo.updateAccountStatus).toHaveBeenCalledOnce();
    const [[, dto]] = repo.updateAccountStatus.mock.calls;
    expect(dto.status).toBe('BLOQUEADO_TEMPORAL');
    expect(dto.blockOrigin).toBe('AUTOMATICO');
  });

  it('3 penalizaciones → aplica BLOQUEADO_PERMANENTE', async () => {
    const repo = makeRepo(savedStatus({ status: 'ACTIVO' }));
    const svc = new AccountStatusService(repo, makeSoporte(3));
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('BLOQUEADO_PERMANENTE');
    expect(repo.updateAccountStatus).toHaveBeenCalledOnce();
  });

  it('ya estaba BLOQUEADO_TEMPORAL con 2 penalizaciones → no persiste de nuevo', async () => {
    const repo = makeRepo(savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'AUTOMATICO' }));
    const svc = new AccountStatusService(repo, makeSoporte(2));
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('BLOQUEADO_TEMPORAL');
    expect(repo.updateAccountStatus).not.toHaveBeenCalled();
  });

  it('penalizaciones bajan de 2 a 0: bloqueo AUTOMATICO → desbloquea a ACTIVO', async () => {
    const repo = makeRepo(savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'AUTOMATICO' }));
    const svc = new AccountStatusService(repo, makeSoporte(0));
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('ACTIVO');
    expect(repo.updateAccountStatus).toHaveBeenCalledOnce();
  });

  it('bloqueo MANUAL no se revierte automáticamente aunque no haya penalizaciones', async () => {
    const repo = makeRepo(savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'MANUAL' }));
    const svc = new AccountStatusService(repo, makeSoporte(0));
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('BLOQUEADO_TEMPORAL');
    expect(repo.updateAccountStatus).not.toHaveBeenCalled();
  });

  it('bloqueo MANUAL con penalizaciones suficientes → sube al nivel que corresponde', async () => {
    // 3 penalizaciones exigen BLOQUEADO_PERMANENTE aunque el manual era solo TEMPORAL
    const repo = makeRepo(savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'MANUAL' }));
    const svc = new AccountStatusService(repo, makeSoporte(3));
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('BLOQUEADO_PERMANENTE');
    expect(result?.blockOrigin).toBe('AUTOMATICO');
  });
});

// ─── Soporte caído — degradación elegante ─────────────────────────────────────

describe('AccountStatusService.getAccountStatus — Soporte caído', () => {
  it('devuelve el último estado guardado sin lanzar error', async () => {
    const saved = savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'AUTOMATICO' });
    const repo = makeRepo(saved);
    const svc = new AccountStatusService(repo, makeSoporteCaido());
    const result = await svc.getAccountStatus('cust_abc', 12);
    expect(result?.status).toBe('BLOQUEADO_TEMPORAL');
    expect(repo.updateAccountStatus).not.toHaveBeenCalled();
  });

  it('no propaga ServiceUnavailableError cuando Soporte está caído', async () => {
    const svc = new AccountStatusService(makeRepo(), makeSoporteCaido());
    await expect(svc.getAccountStatus('cust_abc', 12)).resolves.not.toThrow();
  });
});

// ─── AccountStatusService.updateAccountStatus (PUT manual) ────────────────────

describe('AccountStatusService.updateAccountStatus — baja y bloqueo manual', () => {
  it('dar de baja → blockOrigin undefined (no es bloqueo)', async () => {
    const repo = makeRepo();
    const svc = new AccountStatusService(repo, makeSoporte(0));
    await svc.updateAccountStatus('cust_abc', { status: 'INACTIVO', reason: 'Baja solicitada' });
    const [[, dto]] = repo.updateAccountStatus.mock.calls;
    expect(dto.status).toBe('INACTIVO');
    expect(dto.blockOrigin).toBeUndefined();
  });

  it('bloqueo manual → blockOrigin MANUAL', async () => {
    const repo = makeRepo();
    const svc = new AccountStatusService(repo, makeSoporte(0));
    await svc.updateAccountStatus('cust_abc', { status: 'BLOQUEADO_TEMPORAL', reason: 'Conducta inapropiada' });
    const [[, dto]] = repo.updateAccountStatus.mock.calls;
    expect(dto.blockOrigin).toBe('MANUAL');
  });

  it('cliente inexistente → null', async () => {
    const repo = makeRepo(null);
    // updateAccountStatus del repo también devuelve null
    repo.updateAccountStatus = vi.fn().mockResolvedValue(null);
    const svc = new AccountStatusService(repo, makeSoporte(0));
    const result = await svc.updateAccountStatus('cust_xyz', { status: 'INACTIVO', reason: 'Baja' });
    expect(result).toBeNull();
  });
});
