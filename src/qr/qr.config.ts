export interface QrConfig {
  readonly ttlSeconds: number;
}

export interface QrConfigEnv {
  readonly QR_TTL_SECONDS?: string;
}

const QR_TTL_SECONDS_ENV_VAR = "QR_TTL_SECONDS";
const DEFAULT_TTL_SECONDS = 300;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

function parseTtlSeconds(raw: string): number {
  if (!POSITIVE_INTEGER_PATTERN.test(raw)) {
    throw new Error(
      `${QR_TTL_SECONDS_ENV_VAR} debe ser un entero positivo en segundos. Valor recibido: "${raw}".`,
    );
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `${QR_TTL_SECONDS_ENV_VAR} debe ser un entero positivo en segundos. Valor recibido: "${raw}".`,
    );
  }

  return parsed;
}

export function loadQrConfig(env: QrConfigEnv = process.env): QrConfig {
  const raw = env.QR_TTL_SECONDS;

  if (raw === undefined) {
    return { ttlSeconds: DEFAULT_TTL_SECONDS };
  }

  return { ttlSeconds: parseTtlSeconds(raw) };
}
