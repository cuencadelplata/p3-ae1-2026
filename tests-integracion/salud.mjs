// Chequeo rapido de salud del stack comun: consulta el health de cada modulo y muestra una tabla.
// Sirve para confirmar que todo levanto antes de correr flujo-completo.e2e.mjs o de una demo.
//
// Uso, desde la raiz del repositorio (no necesita dependencias):
//   node tests-integracion/salud.mjs
//
// Usa las mismas URL por defecto que el test integral; cada una se puede cambiar con su
// variable (M1_URL, M2_URL, ..., M9_URL). Termina con codigo 1 si algun modulo no responde.

const url = (nombre, defecto) => (process.env[nombre] || defecto).replace(/\/+$/, '');
const sinApiV1 = (base) => base.replace(/\/api\/v1$/, '');
const TIMEOUT_MS = Number(process.env.SALUD_TIMEOUT_MS || 3000);

const servicios = [
  ['M1 Identidad y acceso', url('M1_URL', 'http://localhost:10000'), '/health'],
  ['M2 Perfil e historial', url('M2_URL', 'http://localhost:11000'), '/health/live'],
  ['M3 Conductores', url('M3_CONDUCTORES_URL', 'http://localhost:5000'), '/health'],
  ['M3 Vehiculos', url('M3_VEHICULOS_URL', 'http://localhost:8083'), '/health'],
  ['M4 Ubicacion', sinApiV1(url('M4_URL', 'http://localhost:3004/api/v1')), '/health'],
  ['M5 Despacho', sinApiV1(url('M5_URL', 'http://localhost:3005/api/v1')), '/health'],
  ['M6 Viajes', url('M6_URL', 'http://localhost:15000'), '/health'],
  ['M7 Tarifas y pagos', url('M7_URL', 'http://localhost:17000'), '/health'],
  ['M8 QR y comprobantes', url('M8_URL', 'http://localhost:18000'), '/health/live'],
  ['M9 Reservas', url('M9_URL', 'http://localhost:3000'), '/health'],
];

async function consultar([nombre, base, ruta]) {
  const destino = `${base}${ruta}`;
  const inicio = Date.now();
  try {
    const respuesta = await fetch(destino, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { nombre, destino, ok: respuesta.ok, estado: String(respuesta.status), ms: Date.now() - inicio };
  } catch (error) {
    const estado = error.name === 'TimeoutError' ? `sin respuesta en ${TIMEOUT_MS} ms` : 'no responde';
    return { nombre, destino, ok: false, estado, ms: Date.now() - inicio };
  }
}

const resultados = await Promise.all(servicios.map(consultar));

for (const { nombre, destino, ok, estado, ms } of resultados) {
  console.log(`${ok ? 'OK   ' : 'FALLA'}  ${nombre.padEnd(24)} ${estado.padEnd(22)} ${String(ms).padStart(5)} ms  ${destino}`);
}

const caidos = resultados.filter((r) => !r.ok).length;
console.log(caidos === 0 ? '\nTodos los modulos responden.' : `\n${caidos} de ${resultados.length} modulos no responden.`);
process.exitCode = caidos === 0 ? 0 : 1;
