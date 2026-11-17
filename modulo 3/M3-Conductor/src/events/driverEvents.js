const { randomUUID } = require("crypto");

/**
 * Catálogo de eventos asíncronos que publica el Módulo 3 (RNF-07).
 * Documentación completa del contrato en docs/EVENTOS.md.
 */
const EVENTOS = {
  DRIVER_AVAILABILITY_UPDATED: {
    tipo: "DriverAvailabilityUpdated",
    routingKey: "driver.availability.updated",
    version: 1
  },
  DRIVER_STATUS_CHANGED: {
    tipo: "DriverStatusChanged",
    routingKey: "driver.status.changed",
    version: 1
  }
};

/**
 * Arma el sobre (envelope) común a todos los eventos del módulo.
 */
function crearEvento(definicion, data) {
  return {
    eventId: randomUUID(),
    eventType: definicion.tipo,
    eventVersion: definicion.version,
    source: "M3-Conductor",
    occurredAt: new Date().toISOString(),
    data
  };
}

/**
 * RF 3.3 - La disponibilidad (efímera, sólo en Redis) de un conductor cambió.
 */
function driverAvailabilityUpdated({ usuarioID, disponible, disponibleAnterior }) {
  return crearEvento(EVENTOS.DRIVER_AVAILABILITY_UPDATED, {
    usuarioID,
    disponible: Boolean(disponible),
    disponibleAnterior: Boolean(disponibleAnterior)
  });
}

/**
 * RF 3.1 - El estado de habilitación (persistido en DB) de un conductor cambió.
 */
function driverStatusChanged({ usuarioID, habilitado, habilitadoAnterior, motivo }) {
  return crearEvento(EVENTOS.DRIVER_STATUS_CHANGED, {
    usuarioID,
    habilitado,
    habilitadoAnterior: habilitadoAnterior ?? null,
    motivo: motivo || null
  });
}

module.exports = {
  EVENTOS,
  driverAvailabilityUpdated,
  driverStatusChanged
};
