import { beforeEach, vi } from 'vitest';
import { m1ProfileClient } from '../../src/clients/m1-profile.client.js';

// Los tests no consultan a M1 por la red: por defecto M1 no entrega datos personales
// (identity: null). Un test puede sobrescribirlo con vi.spyOn(m1ProfileClient, 'getIdentity').
beforeEach(() => {
  vi.spyOn(m1ProfileClient, 'getIdentity').mockResolvedValue(null);
});
