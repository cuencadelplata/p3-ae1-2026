import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpM2PreferencesClient } from '../../src/infrastructure/clients/m2-preferences.client.js';

test('un 404 de M2 no habilita PUSH por defecto', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const client = new HttpM2PreferencesClient('http://m2', 'test-key');
    await assert.rejects(client.getPreferences(42, 'doc-42'), /no se autoriza PUSH/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('un formato de preferencias no acordado tampoco habilita PUSH', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ preferences: { notificationChannel: 'push' } });
  try {
    const client = new HttpM2PreferencesClient('http://m2', 'test-key');
    await assert.rejects(client.getPreferences(42, 'doc-42'), /formato inválido/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
