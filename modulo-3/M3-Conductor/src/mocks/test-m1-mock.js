/**
 * Smoke manual contra M1 REAL (imagen matsir/m1-identidad-acceso).
 * No usa Prism ni mocks.
 *
 *   node src/mocks/test-m1-mock.js
 *
 * Requiere: docker compose up -d m1-identidad-acceso
 */

const {
  M1_URL,
  ensureM1Healthy,
  crearSesionM1
} = require('../../../tests/helpers/m1Client');

async function main() {
  console.log(`🚀 Probando M1 real en ${M1_URL}`);
  const health = await ensureM1Healthy();
  console.log('✅ /health:', health);

  const conductor = await crearSesionM1('CONDUCTOR', {
    nombre: 'Carlos',
    apellido: 'Rodriguez'
  });
  console.log('✅ Conductor M1:', {
    userId: conductor.userId,
    role: conductor.role,
    email: conductor.email,
    token: `${conductor.token.slice(0, 24)}…`
  });

  const cliente = await crearSesionM1('CLIENTE', {
    nombre: 'Ana',
    apellido: 'Cliente'
  });
  console.log('✅ Cliente M1:', {
    userId: cliente.userId,
    role: cliente.role,
    email: cliente.email
  });

  console.log('🎉 M1 real OK — usar estos IDs en M3 (sin mocks).');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
