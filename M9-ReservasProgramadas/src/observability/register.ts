/**
 * Punto de entrada de la telemetría. Debe ser el PRIMER import de cada proceso
 * (`server.ts` y los stubs) para que los proveedores globales existan antes de que
 * cualquier módulo cree tracers o meters.
 *
 * Si la telemetría está apagada o falla al iniciar, el servicio arranca igual: la API de
 * OpenTelemetry queda en modo no-op y la creación de reservas no se ve afectada.
 */
import { telemetryConfig } from './config.js';
import { NOOP_TELEMETRY, startTelemetry, type TelemetryHandle } from './sdk.js';

const initialize = (): { handle: TelemetryHandle; enabled: boolean } => {
  const config = telemetryConfig();
  if (!config.enabled || process.env.NODE_ENV === 'test') {
    return { handle: NOOP_TELEMETRY, enabled: false };
  }
  try {
    return { handle: startTelemetry(config), enabled: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'telemetry_start_failed',
        errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      }),
    );
    return { handle: NOOP_TELEMETRY, enabled: false };
  }
};

const initialized = initialize();

export const telemetry: TelemetryHandle = initialized.handle;
export const telemetryEnabled: boolean = initialized.enabled;
