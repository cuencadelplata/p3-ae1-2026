# Registro de Pruebas y Evidencia de Ejecución — RF-5.2

- **Módulo:** Módulo 5 (Solicitud y Despacho)
- **Requerimiento:** RF-5.2 (Búsqueda de Candidatos y Selección por Proximidad)
- **Requerimientos No Funcionales:** RNF-05 (Resiliencia / Integración entre servicios), RNF-17 (Evidencia de Pruebas y Trazabilidad)
- **Referencias de Cátedra:** AE2 pp. 10-12, p. 32
- **Rama Git:** `ae2/lautaro-romero`
- **Commit Base:** `1493edcc4ac8d2488546615ca65f0349139ca5ea`
- **Fecha y Hora de Ejecución:** 2026-11-14T15:48:00-03:00

---

## 1. Definición y Comprobación del Contrato con M4 (RF-5.2 / RNF-05)

### Contrato HTTP con M4
- **Endpoint:** `GET /api/v1/drivers/nearby`
- **Parámetros de consulta (Query Params):**
  - `latitude`: Coordenada geográfica del origen del viaje (ej: `-34.6037`).
  - `longitude`: Coordenada geográfica del origen del viaje (ej: `-58.3816`).
  - `vehicleType`: Tipo de vehículo requerido (`AUTO` o `MOTO`).
  - `radiusKm`: Radio de cobertura configurable en km (ej: `5.0`). *Nota: La consigna no fija un radio concreto, por lo que es configurable por parámetro.*
  - `maxCandidates`: Cantidad máxima de conductores a retornar (ej: `10`).

### Simulación Declarada y Aprobada por Cátedra (AE2 p.11)
El cliente `M4ClientService` implementa `seedMockDrivers()` para permitir simulaciones declaradas en memoria y pruebas deterministas sin dependencias externas, conforme al punto AE2 p.11.

---

## 2. Tratamiento Explícito de Fallos vs. Ausencia de Candidatos

| Escenario | Condición Técnica | Comportamiento del Sistema | Código de Respuesta |
|---|---|---|---|
| **Ausencia legítima de candidatos (RF-5.7)** | M4 responde `200 OK` con `drivers: []` o tras filtrar por radio/tipo/disponibilidad no quedan candidatos | La solicitud transiciona a estado `NO_DRIVERS_AVAILABLE`. Se emite error controlado de negocio. | `404 Not Found` <br>`code: NO_DRIVERS_AVAILABLE` |
| **Caída / Fallo de conexión de M4 (RNF-05)** | M4 inalcanzable (`ECONNREFUSED`, caída de red, DNS) | **No** se marca la solicitud como `NO_DRIVERS_AVAILABLE`. Se lanza `M4IntegrationError` explícito. | `503 Service Unavailable` <br>`code: M4_CONNECTION_FAILED` |
| **Demora / Timeout de M4 (RNF-05)** | M4 tarda más de 3000 ms (timeout de `AbortController`) | Se interrumpe la llamada y se lanza `M4IntegrationError`. | `504 Gateway Timeout` <br>`code: M4_GATEWAY_TIMEOUT` |
| **Error HTTP de M4 (RNF-05)** | M4 responde con status 5xx o 4xx | Se reporta fallo del servicio externo upstream. | `502 Bad Gateway` / `503` <br>`code: M4_SERVICE_UNAVAILABLE` |

---

## 3. Matriz de Casos de Prueba Ejecutados para RF-5.2

| Caso de Prueba | Descripción del Escenario | Entrada / Setup | Resultado Esperado | Resultado Obtenido | Estado |
|---|---|---|---|---|:---:|
| **Caso 1: Fuera del radio elegido** | Candidato disponible y compatible pero a una distancia mayor al radio elegido | `radiusKm = 3.0`<br>Conductor 1: dist `2.5 km`<br>Conductor 2: dist `6.2 km` | Solo se retorna Conductor 1 (`2.5 km`). Conductor 2 queda descartado por exceder el radio. | Retorna 1 conductor (`dentro-radio`, 2.5 km). Conductor fuera de radio descartado. | **PASS** |
| **Caso 2: No disponibles** | Conductor en radio y compatible pero con estado inactivo | `available = false` en Conductor 2 | Conductor 2 descartado por no estar disponible para servicio. | Retorna únicamente el conductor disponible (`available: true`). | **PASS** |
| **Caso 3: Otro tipo de vehículo** | Conductor en radio y disponible pero de tipo incompatible | Solicitud `AUTO`<br>Conductor 1: `AUTO`<br>Conductor 2: `MOTO` | Conductor 2 descartado por incompatibilidad de tipo vehicular. | Retorna únicamente `conductor-auto`. | **PASS** |
| **Caso 4: Respuesta vacía de M4** | M4 responde `200 OK` con `drivers: []` | M4 responde sin conductores | Se coordina con RF-5.7: estado de la solicitud transiciona a `NO_DRIVERS_AVAILABLE` y responde 404. | `request.status = NO_DRIVERS_AVAILABLE`, lanza `NotFoundError('NO_DRIVERS_AVAILABLE')`. | **PASS** |
| **Caso 5a: Caída de M4** | M4 caído o inaccesible por red (`ECONNREFUSED`) | `global.fetch` rechaza con `ECONNREFUSED` | Lanza `M4IntegrationError` con código `M4_CONNECTION_FAILED` (503). **No** confunde con `NO_DRIVERS_AVAILABLE`. | Lanza `M4IntegrationError` (503). Estado no pasa a `NO_DRIVERS_AVAILABLE`. | **PASS** |
| **Caso 5b: Demora / Timeout de M4** | M4 excede el tiempo límite de espera (timeout 3000 ms) | `AbortError` / señal de aborto | Lanza `M4IntegrationError` con código `M4_GATEWAY_TIMEOUT` (504). | Lanza `M4IntegrationError` (504). | **PASS** |
| **Ordenamiento previo al límite** | Varios conductores con distancias variadas y se solicita `maxCandidates = 2` | 4 conductores: dist `4.0`, `0.5`, `3.5`, `1.0` km | Ordena por distancia ascendente antes del corte: retorna los de `0.5` km y `1.0` km. | Candidatos ordenados: `cerca-1` (0.5 km) y `cerca-2` (1.0 km). | **PASS** |

---

## 4. Evidencia de Ejecución de Suites de Pruebas

### Pruebas Unitarias (`npx jest tests/unit/`)
```
PASS unit tests/unit/ride-request-validator.unit.test.ts
PASS unit tests/unit/ride-request-service.unit.test.ts
PASS unit tests/unit/m4-client.unit.test.ts
PASS unit tests/unit/redis-rabbitmq-ttl.unit.test.ts
PASS unit tests/unit/reopen-dispatch-rabbitmq.unit.test.ts

Test Suites: 5 passed, 5 total
Tests:       112 passed, 112 total
Snapshots:   0 total
Time:        7.444 s
```

### Pruebas de Integración API (`npx jest tests/integration/`)
```
PASS integration tests/integration/ride-request-api.integration.test.ts
  M5 Dispatch Service — API Integration Tests
    GET /health (RNF-16)
      √ debe responder 200 con status UP (23 ms)
    RF-5.1: POST /api/v1/ride-requests & GET /api/v1/ride-requests/:requestId
      √ debe crear una solicitud de viaje con código HTTP 201 (44 ms)
      √ debe responder 400 si falta el header Idempotency-Key (5 ms)
      √ debe responder 400 con detalles si el payload es inválido (4 ms)
      √ debe retornar la misma respuesta idempotente ante la misma Idempotency-Key (RNF-08) (8 ms)
      √ debe responder 409 si el cliente intenta crear una segunda solicitud activa con otra clave (6 ms)
      √ debe consultar una solicitud existente mediante GET /api/v1/ride-requests/:requestId (8 ms)
      √ debe responder 404 para solicitud inexistente (3 ms)
    RF-5.2: POST /api/v1/ride-requests/:requestId/candidates
      √ debe retornar lista de conductores candidatos ordenados por distancia (8 ms)
      √ debe responder 400 si las opciones de búsqueda son inválidas (7 ms)
    RF-5.3: POST & GET /api/v1/ride-requests/:requestId/offers
      √ debe generar y despachar ofertas con TTL (10 ms)
      √ debe consultar las ofertas de una solicitud vía GET (10 ms)
    RF-5.4 & RF-5.5: Gestión de ofertas y Asignación única
      √ debe permitir a un conductor aceptar una oferta y quedar asignado (RF-5.4) (10 ms)
      √ debe permitir a un conductor rechazar una oferta (RF-5.4) (9 ms)
      √ RF-5.5: Ante ofertas concurrentes, solo el primero asigna y el segundo recibe 409 (12 ms)
      √ debe listar las ofertas dirigidas a un conductor en GET /api/v1/drivers/:driverId/offers (10 ms)
    RF-5.6: POST /api/v1/ride-requests/:requestId/cancel
      √ debe cancelar exitosamente una solicitud pendiente con motivo opcional (8 ms)
      √ no debe permitir cancelar una solicitud ya asignada a un conductor (409 Conflict) (13 ms)
      √ no debe permitir cancelar una solicitud ya cancelada (409 Conflict) (29 ms)
    RF-5.7: Notificación de no disponibilidad
      √ debe responder 404 NO_DRIVERS_AVAILABLE si la búsqueda con radio muy bajo no encuentra candidatos (20 ms)
      √ debe responder 503 M4_CONNECTION_FAILED y NO 404 NO_DRIVERS_AVAILABLE ante caída de conexión de M4 (RNF-05) (28 ms)

Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
Snapshots:   0 total
Time:        3.447 s
```
