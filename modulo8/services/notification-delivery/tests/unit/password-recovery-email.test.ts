import test from 'node:test';
import assert from 'node:assert/strict';
import { NonRetryableMessagingError } from '@m8/shared';

import {
  buildPasswordRecoveryEmail,
  parsePasswordRecoveryEvent,
  PASSWORD_RECOVERY_QUEUE,
  PASSWORD_RECOVERY_ROUTING_KEY,
} from '../../src/infrastructure/messaging/password-recovery-email.consumer.js';

// Forma exacta de modulo-1-identidad-acceso/src/messaging/recovery.publisher.ts
const m1Event = {
  id: '0b6f0c0e-7c1e-4b62-9a0e-3f2f3b6c9d11',
  evento: 'auth.recuperacion_solicitada',
  modulo: 'M1',
  fecha: '2026-11-24T20:00:00.000Z',
  datos: { userId: 12, email: 'cliente@example.com', nombre: 'Ana', token: 'a'.repeat(64), expiraEnSegundos: 900 },
};
const buffer = (value: unknown) => Buffer.from(JSON.stringify(value));

test('Correo de recuperación de M1', async (t) => {
  await t.test('convierte el evento de M1 al sobre de M8 conservando el id', () => {
    const envelope = parsePasswordRecoveryEvent(buffer(m1Event), PASSWORD_RECOVERY_ROUTING_KEY);
    assert.equal(envelope.messageId, m1Event.id);
    assert.equal(envelope.producer, 'm1');
    assert.equal(envelope.data.email, 'cliente@example.com');
    assert.equal(envelope.data.userId, 12);
  });

  await t.test('acepta el mismo evento cuando RabbitMQ lo devuelve a la cola principal', () => {
    const envelope = parsePasswordRecoveryEvent(buffer(m1Event), PASSWORD_RECOVERY_QUEUE);
    assert.equal(envelope.messageId, m1Event.id);
    assert.equal(envelope.data.token, m1Event.datos.token);
    const unrelatedEvent = { ...m1Event, evento: 'auth.credenciales_revocadas' };
    assert.throws(
      () => parsePasswordRecoveryEvent(buffer(unrelatedEvent), PASSWORD_RECOVERY_QUEUE),
      NonRetryableMessagingError,
    );
  });

  await t.test('rechaza eventos sin email válido, de otro módulo o con otra routing key', () => {
    const invalid = { ...m1Event, datos: { ...m1Event.datos, email: 'sin-arroba' } };
    assert.throws(() => parsePasswordRecoveryEvent(buffer(invalid), PASSWORD_RECOVERY_ROUTING_KEY), NonRetryableMessagingError);
    assert.throws(() => parsePasswordRecoveryEvent(buffer({ ...m1Event, modulo: 'M2' }), PASSWORD_RECOVERY_ROUTING_KEY), NonRetryableMessagingError);
    assert.throws(() => parsePasswordRecoveryEvent(buffer(m1Event), 'auth.credenciales_revocadas'), NonRetryableMessagingError);
    assert.throws(() => parsePasswordRecoveryEvent(Buffer.from('{roto'), PASSWORD_RECOVERY_ROUTING_KEY), NonRetryableMessagingError);
  });

  await t.test('arma el correo con el nombre, el código y el vencimiento', () => {
    const email = buildPasswordRecoveryEmail({ ...m1Event.datos, nombre: 'Ana <script>' });
    assert.match(email.subject, /Recuperación de contraseña/);
    assert.match(email.text, /Hola Ana <script>:/);
    assert.ok(email.text.includes(m1Event.datos.token));
    assert.match(email.text, /15 minutos/);
    assert.ok(email.html.includes('Ana &lt;script&gt;'), 'el HTML escapa los datos del usuario');
  });
});
