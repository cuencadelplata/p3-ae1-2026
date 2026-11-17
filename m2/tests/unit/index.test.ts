import { describe, it, expect } from 'vitest';
import { getServiceInfo, SERVICE_NAME } from '../../src/index.js';

describe('M2 Clientes - Verificación del Servicio', () => {
  it('debe retornar la información correcta del microservicio', () => {
    const info = getServiceInfo();
    expect(info.service).toBe(SERVICE_NAME);
    expect(info.status).toBe('ONLINE');
    expect(info.version).toBe('1.0.0');
  });
});
