import { describe, it, expect } from 'vitest';
import { ServiceUnavailableError, isServiceUnavailableError, describeError } from '../../src/errors/service-unavailable.error.js';

// Crea un error como los que lanza Node / pg, con un código opcional
function errorWithCode(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

describe('Clasificación de errores de infraestructura (RF-2.1)', () => {
  it('debe reconocer ServiceUnavailableError', () => {
    expect(isServiceUnavailableError(new ServiceUnavailableError())).toBe(true);
  });

  it('debe reconocer la conexión rechazada con la DB apagada (ECONNREFUSED)', () => {
    expect(isServiceUnavailableError(errorWithCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'))).toBe(true);
  });

  it('debe reconocer los timeouts del pool y de las queries de pg', () => {
    expect(isServiceUnavailableError(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isServiceUnavailableError(new Error('Query read timeout'))).toBe(true);
  });

  it('debe reconocer los SQLSTATE de caída y de statement_timeout de PostgreSQL', () => {
    expect(isServiceUnavailableError(errorWithCode('terminating connection due to administrator command', '57P01'))).toBe(true);
    expect(isServiceUnavailableError(errorWithCode('canceling statement due to statement timeout', '57014'))).toBe(true);
    expect(isServiceUnavailableError(errorWithCode('connection failure', '08006'))).toBe(true);
  });

  it('debe reconocer errores de conexión dentro de cause o de un AggregateError', () => {
    const wrapped = new Error('Connection failed', { cause: errorWithCode('connect ECONNREFUSED', 'ECONNREFUSED') });
    const aggregate = new AggregateError([errorWithCode('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED')]);
    expect(isServiceUnavailableError(wrapped)).toBe(true);
    expect(isServiceUnavailableError(aggregate)).toBe(true);
  });

  it('no debe confundir errores de datos o bugs con una caída', () => {
    expect(isServiceUnavailableError(errorWithCode('duplicate key value', '23505'))).toBe(false);
    expect(isServiceUnavailableError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isServiceUnavailableError(null)).toBe(false);
  });

  it('describeError debe usar el código cuando el mensaje viene vacío (AggregateError de Node)', () => {
    const aggregate = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
    expect(describeError(aggregate)).toBe('ECONNREFUSED');
    expect(describeError(new Error('Query read timeout'))).toBe('Query read timeout');
  });
});
