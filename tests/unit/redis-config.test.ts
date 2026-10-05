import { describe, expect, it } from 'vitest';
import { redis } from '../../src/config/redis.js';

describe('Configuración de Redis', () => {
  it('acota conexión y comandos a 500ms sin cola offline', () => {
    // Given / When
    const options = redis.options;

    // Then
    expect(options.connectTimeout).toBe(500);
    expect(options.commandTimeout).toBe(500);
    expect(options.enableOfflineQueue).toBe(false);
    expect(options.lazyConnect).toBe(true);
  });
});
