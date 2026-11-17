/**
 * Genera un JWT HS256 de DESARROLLO para probar los endpoints protegidos de M5.
 *
 * Uso (PowerShell, desde modulo-5):
 *   $env:JWT_SECRET = "clave-solo-para-demo-local-cambiar"
 *   node scripts/dev-token.js client_demo 3600
 *
 * Argumentos: <userId> [segundosDeVida=3600]
 * El secreto debe ser el mismo con el que corre el servicio.
 */
const { createHmac } = require('node:crypto');

const userId = process.argv[2];
const ttl = Number(process.argv[3] || 3600);
const secret = process.env.JWT_SECRET;

if (!userId || !secret) {
  console.error('Uso: JWT_SECRET=<secreto> node scripts/dev-token.js <userId> [segundos]');
  process.exit(1);
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const head = encode({ alg: 'HS256', typ: 'JWT' });
const body = encode({ sub: userId, exp: Math.floor(Date.now() / 1000) + ttl });
const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');

console.log(`${head}.${body}.${signature}`);
