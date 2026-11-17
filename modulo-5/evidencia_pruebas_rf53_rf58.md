# Evidencia de Pruebas: Ciclo de Vida de Ofertas, Vencimiento y Trazabilidad (RF-5.3 / RF-5.7 / RF-5.8)

**Módulo**: Módulo 5 — Solicitud y Despacho  
**Materia**: Paradigmas de Programación III (AE2)  
**Rama**: `ae2/lautaro-romero`  
**Fecha de Ejecución**: 14 de Noviembre de 2026  
**Requisitos cubiertos**: RF-5.3 (Oferta con vencimiento), RF-5.4 (Respuesta a oferta), RF-5.7 (Sin disponibilidad / Ciclo de tandas), RF-5.8 (Trazabilidad de oferta y timeout), RNF-04, RNF-06, RNF-07, RNF-09, RNF-17.

---

## 1. Definición del Comportamiento ante Vencimiento de Tanda vs. Vencimiento de Búsqueda (RF-5.3 / RF-5.7 / RF-5.8)

| Escenario | Condición | Comportamiento del Sistema | Estado Resultante | Evento Auditado (RF-5.8) |
|---|---|---|---|---|
| **Vencimiento de una tanda (TTL)** | `now > offer.expiresAt` de todas las ofertas de la tanda, pero `now < request.expiresAt` (plazo de búsqueda sigue vigente) | **No se cierra la búsqueda**. La solicitud regresa a `SEARCHING`. Se permite emitir una nueva tanda de ofertas con otros candidatos elegibles. | `SEARCHING` | `BATCH_TIMEOUT` |
| **Vencimiento definitivo del plazo de búsqueda** | `now >= request.expiresAt` (plazo general de búsqueda de 3 minutos agotado) | **Se cierra definitivamente el proceso**. No se permiten nuevas ofertas ni búsquedas. Se informa timeout. | `EXPIRED` | `SEARCH_TIMEOUT` |
| **Ausencia de candidatos en búsqueda (RF-5.7)** | M4 responde exitosamente pero con lista vacía dentro del radio configurado | Se notifica al cliente que no hay conductores disponibles para el tipo de vehículo solicitado. | `NO_DRIVERS_AVAILABLE` (HTTP 404) | `REQUEST_STATE_CHANGE` |
| **Aceptación concurrente (RF-5.5)** | Un conductor acepta la oferta vigente | Se asigna el viaje al conductor ganador (`ASSIGNED`), y se revocan/expiran automáticamente las ofertas restantes. | `ASSIGNED` | `OFFER_ACCEPTED`, `OFFER_EXPIRED` |
| **Aceptación tardía / sobre el límite** | Conductor intenta aceptar tras vencer TTL | Se rechaza con `409 Conflict` (`OFFER_EXPIRED`). Si se envía milisegundos antes del límite, se procesa exitosamente. | Mantiene estado | `OFFER_EXPIRED` |

---

## 2. Política de Persistencia y Trazabilidad (RF-5.8 / RNF-04 / AE2 p.11 & p.29)

### Justificación de Datos Persistidos (RNF-04)
Conforme a la consigna, **no se exige persistir permanentemente todo dato efímero** (como pings de ubicación o mensajes en tránsito en colas). Se conserva una pista de auditoría mínima que permite reconstruir la historia del despacho:
- `timestamp`: Marca temporal en formato ISO-8601.
- `event`: Tipo de evento de dominio (`OFFER_CREATED`, `OFFER_EXPIRED`, `OFFER_ACCEPTED`, `OFFER_REJECTED`, `BATCH_TIMEOUT`, `SEARCH_TIMEOUT`).
- `requestId`: Identificador único de la solicitud de viaje (clave de correlación).
- `offerId` y `driverId`: Identificadores de la oferta y destinatario involucrados.
- `previousStatus` y `newStatus`: Transición de estado verificada.
- `details`: Descripción contextual del evento.

---

## 3. Matriz de Casos de Prueba Ejecutados

| ID Caso | Descripción | Componentes Involucrados | Resultado |
|---|---|---|:---:|
| **CP-OFF-01** | Vencimiento de tanda sin consultas (TTL expirado) retorna solicitud a `SEARCHING` para nueva ronda | Redis TTL + In-Memory Store | **PASS** |
| **CP-OFF-02** | Re-emisión de nueva tanda tras `BATCH_TIMEOUT` con nuevo conductor candidato | RideRequestService + RabbitMQ | **PASS** |
| **CP-OFF-03** | Rechazo total de ofertas con plazo de búsqueda expirado pasa a `EXPIRED` y genera `SEARCH_TIMEOUT` | RideRequestService (RF-5.7/5.8) | **PASS** |
| **CP-OFF-04** | Aceptación de oferta cerca del límite de expiración (dentro de ventana válida) | Redis + RideRequestService (RF-5.4) | **PASS** |
| **CP-OFF-05** | Rechazo de aceptación una vez superado el límite exacto de expiración | Redis + RideRequestService | **PASS** |
| **CP-OFF-06** | Revocación automática de ofertas pendientes al aceptar un conductor la asignación | RideRequestService + Redis (RF-5.5) | **PASS** |
| **CP-OFF-07** | Deduplicación de driverIds y descarte de conductores con oferta PENDING existente | Validaciones RF-5.3 | **PASS** |

---

## 4. Evidencia de Ejecución de Suites de Prueba

### Tests Unitarios (122 tests en 5 suites)
```bash
npx jest tests/unit/ --no-cache --forceExit

PASS unit tests/unit/ride-request-validator.unit.test.ts
PASS unit tests/unit/reopen-dispatch-rabbitmq.unit.test.ts
PASS unit tests/unit/m4-client.unit.test.ts
PASS unit tests/unit/redis-rabbitmq-ttl.unit.test.ts
PASS unit tests/unit/ride-request-service.unit.test.ts

Test Suites: 5 passed, 5 total
Tests:       122 passed, 122 total
Snapshots:   0 total
Time:        7.965 s
```

### Tests de Integración API (21 tests en 1 suite)
```bash
npx jest tests/integration/ride-request-api.integration.test.ts --forceExit

PASS integration tests/integration/ride-request-api.integration.test.ts
  M5 Dispatch Service — API Integration Tests
    GET /health (RNF-16)
      √ debe responder 200 con status UP
    RF-5.1: POST /api/v1/ride-requests & GET /api/v1/ride-requests/:requestId
      √ debe crear una solicitud de viaje con código HTTP 201
      √ debe responder 400 si falta el header Idempotency-Key
      √ debe responder 400 con detalles si el payload es inválido
      √ debe retornar la misma respuesta idempotente ante la misma Idempotency-Key (RNF-08)
      √ debe responder 409 si el cliente intenta crear una segunda solicitud activa con otra clave
      √ debe consultar una solicitud existente mediante GET /api/v1/ride-requests/:requestId
      √ debe responder 404 para solicitud inexistente
    RF-5.2: POST /api/v1/ride-requests/:requestId/candidates
      √ debe retornar lista de conductores candidatos ordenados por distancia
      √ debe responder 400 si las opciones de búsqueda son inválidas
    RF-5.3: POST & GET /api/v1/ride-requests/:requestId/offers
      √ debe generar y despachar ofertas con TTL
      √ debe consultar las ofertas de una solicitud vía GET
    RF-5.4 & RF-5.5: Gestión de ofertas y Asignación única
      √ debe permitir a un conductor aceptar una oferta y quedar asignado (RF-5.4)
      √ debe permitir a un conductor rechazar una oferta (RF-5.4)
      √ RF-5.5: Ante ofertas concurrentes, solo el primero asigna y el segundo recibe 409
      √ debe listar las ofertas dirigidas a un conductor en GET /api/v1/drivers/:driverId/offers
    RF-5.6: POST /api/v1/ride-requests/:requestId/cancel
      √ debe cancelar exitosamente una solicitud pendiente con motivo opcional
      √ no debe permitir cancelar una solicitud ya asignada a un conductor (409 Conflict)
      √ no debe permitir cancelar una solicitud ya cancelada (409 Conflict)
    RF-5.7: Notificación de no disponibilidad
      √ debe responder 404 NO_DRIVERS_AVAILABLE si la búsqueda con radio muy bajo no encuentra candidatos
      √ debe responder 503 M4_CONNECTION_FAILED y NO 404 NO_DRIVERS_AVAILABLE ante caída de conexión de M4 (RNF-05)

Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
```
