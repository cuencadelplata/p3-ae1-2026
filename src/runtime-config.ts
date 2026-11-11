type UrlScheme = 'amqp:' | 'amqps:' | 'postgres:' | 'postgresql:' | 'redis:' | 'rediss:' | 'http:' | 'https:';

const requiredUrls: Record<string, readonly UrlScheme[]> = {
  RABBITMQ_URL: ['amqp:', 'amqps:'],
  NOTIFICATIONS_DATABASE_URL: ['postgres:', 'postgresql:'],
  DELIVERY_DATABASE_URL: ['postgres:', 'postgresql:'],
  RECEIPTS_DATABASE_URL: ['postgres:', 'postgresql:'],
  SUPPORT_DATABASE_URL: ['postgres:', 'postgresql:'],
  REDIS_URL: ['redis:', 'rediss:'],
  M1_IDENTITY_URL: ['http:', 'https:'],
  M2_API_URL: ['http:', 'https:'],
  M7_PAYMENTS_URL: ['http:', 'https:'],
  FISCAL_API_URL: ['http:', 'https:'],
};

const requiredSecrets = ['M1_JWT_SECRET', 'M2_INTERNAL_API_KEY'] as const;

/** Valida la app única antes de abrir el puerto. Los errores sólo nombran variables. */
export function validateM8RuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const missing = [...Object.keys(requiredUrls), ...requiredSecrets]
    .filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Configuración incompleta de M8: ${missing.join(', ')}.`);
  }

  for (const [name, schemes] of Object.entries(requiredUrls)) {
    let parsed: URL;
    try {
      parsed = new URL(env[name]!);
    } catch {
      throw new Error(`La variable ${name} debe contener una URL válida.`);
    }
    if (!schemes.includes(parsed.protocol as UrlScheme) || !parsed.hostname) {
      throw new Error(`La variable ${name} tiene un protocolo o host inválido.`);
    }
  }
}
