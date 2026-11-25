import { randomBytes, createECDH } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function generateEnvironment(domain, email) {
  if (!domain || domain.includes('localhost') || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
    throw new Error('Indicar un dominio base sin https://, por ejemplo 1-2-3-4.sslip.io.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) throw new Error('Indicar un email válido para HTTPS.');
  const secret = () => randomBytes(32).toString('hex');
  const vapid = createECDH('prime256v1');
  vapid.generateKeys();
  const jwt = secret();
  const values = {
    AWS_EXPECTED_ACCOUNT_ID: '295552411532', AWS_REGION: 'sa-east-1',
    APP_DOMAIN: `app.${domain}`, M9_DOMAIN: `reservas.${domain}`, M8_DOMAIN: `m8.${domain}`, ACME_EMAIL: email,
    JWT_SECRET: jwt, M1_JWT_SECRET: jwt, M1_NODE_ENV: 'production', AUTH_MODE: 'jwt',
    M9_AUTH_MODE: 'm1', SKIP_AUTH_VALIDATION: 'false', ROUTE_RESOLVER_MODE: 'm4',
    M9_DISPATCH_AUTH_URL: 'http://m1-identidad-acceso:3001/auth/token-delegado',
    M9_DISPATCH_AUTH_TOKEN: secret(), M1_INTERNAL_API_KEY: secret(), QR_INTERNAL_API_KEY: secret(),
    M7_API_KEY: secret(), M2_INTERNAL_API_KEY: secret(), M2_INTEGRATION_SECRET: secret(),
    M2_SOPORTE_SECRET_KEY: secret(), M2_STATUS_SECRET_KEY: secret(),
    POSTGRES_USER: 'm9', POSTGRES_DB: 'm9_reservas', POSTGRES_PASSWORD: secret(),
    RABBITMQ_USER: 'movilidad', RABBITMQ_PASSWORD: secret(), M5_DB_PASSWORD: secret(), M6_DB_PASSWORD: secret(),
    M2_POSTGRES_PASSWORD: secret(), M4_POSTGRES_PASSWORD: secret(),
    M8_POSTGRES_PASSWORD: secret(), M8_NOTIFICATIONS_DB_PASSWORD: secret(), M8_RECEIPTS_DB_PASSWORD: secret(),
    M8_SUPPORT_DB_PASSWORD: secret(), M8_DELIVERY_DB_PASSWORD: secret(),
    M1_OPERADOR_EMAIL: email, M1_OPERADOR_PASSWORD: secret(),
    M8_VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
    M8_VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'),
    M8_VAPID_SUBJECT: `mailto:${email}`,
    M8_SMTP_HOST: 'smtp.gmail.com', M8_SMTP_PORT: '465',
    M8_SMTP_USER: '', M8_SMTP_PASSWORD: '', M8_MAIL_FROM: '',
    GRAFANA_CLOUD_REMOTE_WRITE_URL: '', GRAFANA_CLOUD_USER: '', GRAFANA_CLOUD_TOKEN: '',
    M7_DB_PASSWORD: secret(), M7_SUPABASE_URL: '', M7_SUPABASE_KEY: '', MP_ACCESS_TOKEN: '', MP_PUBLIC_KEY: '',
    SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
  };
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const target = new URL('./.env', import.meta.url);
    if (existsSync(target)) throw new Error('El archivo deployment/aws/.env ya existe; no se reemplazaron sus claves.');
    writeFileSync(target, generateEnvironment(process.argv[2], process.argv[3]), { mode: 0o600, flag: 'wx' });
    console.log('Creado deployment/aws/.env con claves privadas nuevas. Completar M3, M7 y SMTP antes del despliegue.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
