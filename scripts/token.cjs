// Pide al stub de M1 un token de prueba (JWT) para un userId: es la identidad que
// acepta todo M2, incluidas direcciones (RF-2.2) y calificaciones (RF-2.4).
// Requiere la API levantada con STUBS_ENABLED=true (el compose ya lo trae).
//   node scripts/token.cjs [userId]      (por defecto 12, el cliente de demo)
const userId = Number(process.argv[2] ?? 12);
const base = process.env.M2_URL ?? 'http://localhost:3000';
fetch(`${base}/__stubs/m1/auth/token-de-prueba`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, role: 'CLIENTE' })
})
  .then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log((await res.json()).token);
  })
  .catch((error) => {
    console.error(`No se pudo obtener el token desde ${base} (${error.message}). ¿Está levantada la API?`);
    process.exit(1);
  });
