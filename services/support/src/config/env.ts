export interface SupportConfig {
  port: string | number;
  rabbitUrl: string;
  // Publicación de ticket.* y consumer RabbitMQ heredados de AE1.
  legacyEvents: boolean;
}

export interface M6TripsConfig {
  baseUrl: string;
  timeoutMs: number;
}

const M6_TIMEOUT_MS_POR_DEFECTO = 2000;

// Verificación de viajes contra M6 (GET /api/viajes/{id}). Sin M6_TRIPS_URL
// devuelve undefined: la verificación queda desactivada.
export function loadM6TripsConfig(env: NodeJS.ProcessEnv = process.env): M6TripsConfig | undefined {
  const baseUrl = (env.M6_TRIPS_URL ?? '').trim().replace(/\/+$/, '');
  if (baseUrl === '') {
    return undefined;
  }

  const rawTimeout = (env.M6_TIMEOUT_MS ?? '').trim();
  const timeoutMs = rawTimeout === '' ? M6_TIMEOUT_MS_POR_DEFECTO : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`M6_TIMEOUT_MS debe ser un entero positivo (recibido: "${rawTimeout}")`);
  }
  return { baseUrl, timeoutMs };
}

export interface M1IdentityConfig {
  baseUrl: string;
  timeoutMs: number;
}

const M1_TIMEOUT_MS_POR_DEFECTO = 2000;

// Autenticación contra M1 (GET /auth/validar-identidad-y-rol). Sin
// SUPPORT_M1_IDENTITY_URL devuelve undefined: /tickets no exige Bearer.
//
// No se usa M1_IDENTITY_URL: en el contenedor único de M8 esa variable ya la
// define Receipts (RF8.4) con la URL completa del endpoint, y activaría la
// autenticación de Support sin que nadie lo haya pedido.
export function loadM1IdentityConfig(env: NodeJS.ProcessEnv = process.env): M1IdentityConfig | undefined {
  const baseUrl = (env.SUPPORT_M1_IDENTITY_URL ?? '').trim().replace(/\/+$/, '');
  if (baseUrl === '') {
    return undefined;
  }

  const rawTimeout = (env.M1_TIMEOUT_MS ?? '').trim();
  const timeoutMs = rawTimeout === '' ? M1_TIMEOUT_MS_POR_DEFECTO : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`M1_TIMEOUT_MS debe ser un entero positivo (recibido: "${rawTimeout}")`);
  }
  return { baseUrl, timeoutMs };
}

export function loadSupportConfig(env: NodeJS.ProcessEnv = process.env): SupportConfig {
  const legacyEvents = env.SUPPORT_LEGACY_EVENTS ?? 'on';
  if (legacyEvents !== 'on' && legacyEvents !== 'off') {
    throw new Error(`SUPPORT_LEGACY_EVENTS debe ser "on" u "off" (recibido: "${legacyEvents}")`);
  }

  return {
    port: env.PORT || 3000,
    rabbitUrl: env.RABBITMQ_URL || 'amqp://localhost:5672',
    legacyEvents: legacyEvents === 'on',
  };
}
