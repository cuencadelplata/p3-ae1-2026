export interface QrConfig {
  readonly ttlSeconds: number;
  readonly expiredGraceSeconds: number;
  readonly redisUrl: string | undefined;
}

export interface QrConfigEnv {
  readonly QR_TTL_SECONDS?: string;
  readonly QR_EXPIRED_GRACE_SECONDS?: string;
  readonly REDIS_URL?: string;
}

const DEFAULT_TTL_SECONDS = 300;
// Margen posterior al vencimiento durante el cual una validación informa 410 en vez de 404.
const DEFAULT_EXPIRED_GRACE_SECONDS = 3600;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const REDIS_URL_PROTOCOLS = new Set(["redis:", "rediss:"]);

function parsePositiveIntegerSeconds(name: string, raw: string): number {
  if (!POSITIVE_INTEGER_PATTERN.test(raw)) {
    throw new Error(`${name} debe ser un entero positivo en segundos. Valor recibido: "${raw}".`);
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} debe ser un entero positivo en segundos. Valor recibido: "${raw}".`);
  }

  return parsed;
}

// El mensaje no repite el valor recibido: una URL de Redis puede incluir credenciales.
function parseRedisUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("REDIS_URL debe ser una URL redis:// o rediss:// válida.");
  }

  if (!REDIS_URL_PROTOCOLS.has(url.protocol) || url.hostname === "") {
    throw new Error("REDIS_URL debe ser una URL redis:// o rediss:// válida.");
  }

  return raw;
}

export function loadQrConfig(env: QrConfigEnv = process.env): QrConfig {
  return {
    ttlSeconds:
      env.QR_TTL_SECONDS === undefined
        ? DEFAULT_TTL_SECONDS
        : parsePositiveIntegerSeconds("QR_TTL_SECONDS", env.QR_TTL_SECONDS),
    expiredGraceSeconds:
      env.QR_EXPIRED_GRACE_SECONDS === undefined
        ? DEFAULT_EXPIRED_GRACE_SECONDS
        : parsePositiveIntegerSeconds("QR_EXPIRED_GRACE_SECONDS", env.QR_EXPIRED_GRACE_SECONDS),
    redisUrl: env.REDIS_URL === undefined ? undefined : parseRedisUrl(env.REDIS_URL),
  };
}
