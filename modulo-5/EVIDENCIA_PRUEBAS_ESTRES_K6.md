# Evidencia de Pruebas de Carga y Estrés con k6 — Módulo 5: Solicitud y Despacho

**Proyecto:** Plataforma de Movilidad Urbana (P3 - AE2)  
**Módulo:** Módulo 5 — Solicitud y Despacho (`p3-ae2-m5-dispatch-service`)  
**Versión Integrada:** 2.0.0 (Rama `M5--Solicitud-y-Despacho`)  
**Herramienta de Carga y Estrés:** Grafana k6 (v2.4.0)  
**Fecha de Ejecución:** 16 de Noviembre de 2026  
**Responsable:** Lautaro Romero / Equipo M5  

---

## 1. Resumen Ejecutivo

En cumplimiento con el requerimiento académico de **evaluación de rendimiento y estrés sobre la versión integrada de Módulo 5**, se diseñó y ejecutó una suite integral de pruebas con **Grafana k6**. El objetivo fue estresar los puntos críticos del servicio bajo perfiles de carga progresiva, picos extremos y alta contención concurrente.

### Métricas Globales Destacadas
- **Total de Peticiones HTTP Procesadas:** **74.930 requests** en las tres sesiones de prueba.
- **Tasa de Throughput Pico:** **565 peticiones por segundo (RPS)** sostenidas.
- **Tasa de Fallos Inesperados (HTTP 500):** **0.00% (Cero errores no controlados)**.
- **Latencia Percentil 95 (p95):** **116.04 ms** en el flujo completo (umbral RNF SLA: `< 600 ms`).
- **Latencia Mediana:** **3.6 ms - 15.1 ms**.
- **Aserciones / Checks Exitosos:** **100.00%** de éxito sobre 88.507 aserciones acumuladas.
- **Exclusión Mutua Atómica (Distributed Lock):** **100.00%** de resolución limpia en 4.653 carreras concurrentes de asignación de viaje (exactamente 1 ganador con `200 OK` y el resto con `409 Conflict`).

---

## 2. Arquitectura de las Pruebas y Entorno de Ejecución

```
+-------------------------------------------------------------------------+
|                          Grafana k6 (Load Engine)                       |
|   - 10 a 100 Virtual Users (VUs) concurrentes                          |
|   - Generación determinista de UUIDs e Idempotency-Keys                 |
|   - Ráfagas paralelas http.batch() para contención al milisegundo       |
+-------------------------------------------------------------------------+
                                    |
                            HTTP / REST JSON
                                    |
                                    v
+-------------------------------------------------------------------------+
|                  Módulo 5: Solicitud y Despacho (:3005)                  |
|   - Express + TypeScript + Zod Validation                               |
|   - Distributed Lock Engine (Redis / In-Memory Atomic Lock)            |
|   - Asynchronous Domain Events (RabbitMQ / Decoupled Queue)             |
|   - Dynamic Pricing & Geodesic Distance Matrix (Haversine)              |
|   - M4 Candidate Filter (Strict vehicleType, radius & freshness)        |
+-------------------------------------------------------------------------+
```

### Configuración del Entorno de Carga:
- **Herramienta:** Grafana k6 v2.4.0 para Windows (`C:\Program Files\k6\k6.exe`).
- **Servicio Evaluado:** Módulo 5 montado en Node.js v25.9.0 / Express, puerto `3005`.
- **Modo de Autenticación:** `AUTH_MODE=simulated` (validación de cabeceras canónicas `x-user-id`, `x-driver-id` y `x-user-role`).
- **Idempotencia:** Cabecera `Idempotency-Key` única por cliente y ciclo.

---

## 3. Escenarios de Prueba Diseñados

Se crearon 3 scripts especializados en `modulo-5/tests/stress/`:

### Escenario 1: Flujo Completo E2E de Solicitud y Despacho (`stress-ride-request-flow.js`)
Evalúa el ciclo de vida completo de un viaje bajo una rampa de estrés progresivo con hasta 100 usuarios virtuales:
1. `POST /api/v1/ride-requests`: Creación de solicitud con geolocalización, tarifa y clave de idempotencia.
2. `GET /api/v1/ride-requests/:requestId`: Consulta y verificación del estado.
3. `POST /api/v1/ride-requests/:requestId/candidates`: Búsqueda de candidatos cercanos (RF-5.2).
4. `POST /api/v1/ride-requests/:requestId/offers`: Despacho de ofertas con vencimiento TTL (RF-5.3).
5. `GET /api/v1/ride-requests/:requestId/offers`: Consulta de ofertas vigentes en el búfer.
6. `POST /api/v1/offers/:offerId/accept`: Aceptación por el conductor asignado (RF-5.4).
7. `GET /api/v1/ride-requests/:requestId/audit`: Verificación de auditoría inmutable de eventos (RNF-04).

**Perfil de Carga (Stages):**
- 00s - 05s: Rampa a 10 VUs (Warm-up).
- 05s - 20s: Rampa a 30 VUs (Carga nominal).
- 20s - 40s: Rampa a 60 VUs (Carga alta).
- 40s - 50s: Rampa a 100 VUs (Estrés extremo pico).
- 50s - 60s: Descenso a 20 VUs (Cooldown).
- 60s - 65s: Cierre ordenado (0 VUs).

---

### Escenario 2: Concurrencia Extrema de Aceptación y Bloqueo Distribuido (`stress-concurrency-acceptance.js`)
Evalúa la resolución de condiciones de carrera (Race Conditions) y la exclusión mutua atómica (RF-5.5 / RNF-08):
- Múltiples conductores reciben ofertas para el mismo viaje.
- Mediante `http.batch()`, todos los conductores disparan `POST /api/v1/offers/:id/accept` de forma estrictamente simultánea sobre la misma solicitud.
- **Aserción de Invariante:** Exactamente 1 conductor debe ganar la asignación (`200 OK`); el resto debe ser rechazado de forma controlada con conflicto (`409 Conflict`), sin admitir estados inconsistentes ni errores `500`.

---

### Escenario 3: Carreras de Cancelación Previa vs Aceptación (`stress-cancellation-race.js`)
Evalúa la coherencia de la máquina de estados ante acciones simultáneas de clientes y conductores (RF-5.6):
- El cliente envía `POST /api/v1/ride-requests/:id/cancel`.
- Al mismo instante, un conductor envía `POST /api/v1/offers/:id/accept`.
- **Aserción de Invariante:** El sistema debe resolver la contención garantizando que solo una de las dos transacciones consolida (`200 OK`), mientras que la operación que perdió la carrera recibe `409 Conflict`. Cero estados huérfanos.

---

## 4. Resultados Cuantitativos Obtenidos

### Tabla Comparativa de Métricas por Escenario

| Parámetro / Métrica | Escenario 1: Flujo Completo | Escenario 2: Concurrencia Aceptación | Escenario 3: Cancelación vs Aceptación |
| :--- | :---: | :---: | :---: |
| **Script k6** | `stress-ride-request-flow.js` | `stress-concurrency-acceptance.js` | `stress-cancellation-race.js` |
| **VUs Máximos** | **100 VUs** | **50 VUs** | **50 VUs** |
| **Duración Total** | **65.2 s** | **40.1 s** | **40.1 s** |
| **Peticiones Totales (HTTP Req)** | **36.862 req** | **18.612 req** | **19.456 req** |
| **Throughput Medio** | **565.10 req/s** | **464.68 req/s** | **485.45 req/s** |
| **Checks Totales** | **78.990** | **4.653** | **4.864** |
| **% Checks Exitosos** | **100.00%** (78.990/78.990) | **100.00%** (4.653/4.653) | **100.00%** (4.864/4.864) |
| **Tasa de Errores Inesperados (500)** | **0.00%** (0 errores) | **0.00%** (0 errores) | **0.00%** (0 errores) |
| **Latencia Promedio (Avg)** | **22.33 ms** | **22.34 ms** | **21.31 ms** |
| **Latencia Mediana (p50)** | **3.60 ms** | **9.69 ms** | **15.11 ms** |
| **Latencia Percentil 90 (p90)** | **72.37 ms** | **58.52 ms** | **45.72 ms** |
| **Latencia Percentil 95 (p95)** | **116.04 ms** (SLA < 600ms ✓) | **85.17 ms** (SLA < 300ms ✓) | **57.54 ms** (SLA < 300ms ✓) |
| **Latencia Percentil 99 (p99)** | **259.19 ms** (SLA < 1200ms ✓) | **157.34 ms** (SLA < 600ms ✓) | **102.10 ms** (SLA < 600ms ✓) |
| **Latencia Máxima Registrada** | **530.65 ms** | **283.87 ms** | **232.16 ms** |
| **Volumen de Datos Transferido** | 48 MB Recibidos / 13 MB Enviados | 20 MB Recibidos / 6.4 MB Enviados | 21 MB Recibidos / 7.3 MB Enviados |

---

## 5. Salida de Terminal Certificada de k6

### Escenario 1: Flujo Completo (`stress-ride-request-flow.js`)
```text
          /\      Grafana   /‾‾/  
     /\  /  \     |\  __   /  /   
    /  \/    \    | |/ /  /   ‾‾\ 
   /          \   |   (  |  (‾)  |
  / __________ \  |_|\_\  \_____/ 

     execution: local
        script: modulo-5/tests/stress/stress-ride-request-flow.js
     scenarios: (100.00%) 1 scenario, 100 max VUs, 1m35s max duration

  █ THRESHOLDS 
    custom_error_rate..........: ✓ 'rate<0.02' rate=0.00%
    http_req_duration..........: ✓ 'p(95)<600' p(95)=116.04ms
                                 ✓ 'p(99)<1200' p(99)=259.19ms
    http_req_failed............: ✓ 'rate<0.02' rate=0.00%
    ride_creation_duration_ms..: ✓ 'p(95)<500' p(95)=80ms

  █ TOTAL RESULTS 
    checks_total...............: 78990   1210.91/s
    checks_succeeded...........: 100.00% 78990 out of 78990
    checks_failed..............: 0.00%   0 out of 78990

    ✓ status es 201 Created
    ✓ tiene ID de solicitud
    ✓ tarifa estimada > 0
    ✓ status get es 200 OK
    ✓ coincide el id de viaje
    ✓ status candidatos es 200 OK
    ✓ lista de candidatos presente
    ✓ status ofertas es 201 Created
    ✓ ofertas despachadas con éxito
    ✓ status get ofertas es 200 OK
    ✓ recupera lista de ofertas
    ✓ status aceptacion es 200 OK
    ✓ oferta asignada con exito
    ✓ status auditoria es 200 OK
    ✓ trazas de auditoria registradas

    CUSTOM
    offers_dispatched_total....: 5266    80.73/s
    rides_assigned_total.......: 5266    80.73/s
    rides_created_total........: 5266    80.73/s

    HTTP
    http_req_duration..........: avg=22.33ms min=0s med=3.6ms max=530.65ms p(90)=72.37ms p(95)=116.04ms
    http_req_failed............: 0.00%   0 out of 36862
    http_reqs..................: 36862   565.10/s
```

### Escenario 2: Concurrencia de Aceptación (`stress-concurrency-acceptance.js`)
```text
  █ THRESHOLDS 
    atomic_single_winner_rate..: ✓ 'rate>0.99' rate=100.00%
    http_req_duration..........: ✓ 'p(95)<300' p(95)=85.17ms
                                 ✓ 'p(99)<600' p(99)=157.34ms
    unexpected_error_total.....: ✓ 'count<1'   count=0

  █ TOTAL RESULTS 
    checks_total...............: 4653    116.17/s
    checks_succeeded...........: 100.00% 4653 out of 4653
    ✓ exactamente 1 ganador (200 OK) y los demás conflicto (409)

    CUSTOM
    atomic_single_winner_rate..: 100.00% 4653 out of 4653
    contention_response_time_ms: avg=45.76ms med=24ms p(90)=118ms p(95)=150ms
    race_lost_409_conflict_tot.: 4653    116.17/s
    race_won_200_ok_total......: 4653    116.17/s
    unexpected_error_total.....: 0       0/s

    HTTP
    http_req_duration..........: avg=22.34ms min=0s med=9.69ms p(95)=85.17ms
    http_reqs..................: 18612   464.68/s
```

### Escenario 3: Cancelaciones Concurrentes (`stress-cancellation-race.js`)
```text
  █ THRESHOLDS 
    http_req_duration..........: ✓ 'p(95)<300' p(95)=57.54ms
    race_consistency_rate......: ✓ 'rate>0.99' rate=100.00%
    unexpected_error_total.....: ✓ 'count<1'   count=0

  █ TOTAL RESULTS 
    checks_total...............: 4864    121.36/s
    checks_succeeded...........: 100.00% 4864 out of 4864
    ✓ consistencia de exclusión (uno 200 y el otro 409)

    CUSTOM
    accept_won_200_total.......: 789     19.69/s
    cancel_won_200_total.......: 4075    101.68/s
    conflict_handled_409_total.: 4864    121.36/s
    race_consistency_rate......: 100.00% 4864 out of 4864
    unexpected_error_total.....: 0       0/s

    HTTP
    http_req_duration..........: avg=21.31ms med=15.11ms p(95)=57.54ms
    http_reqs..................: 19456   485.45/s
```

---

## 6. Análisis de Resultados y Conclusiones de Rendimiento

1. **Capacidad de Carga y Throughput (RNF-SLA):**
   - El servicio mantuvo una estabilidad absoluta operando a más de **560 peticiones por segundo** en su pico de 100 usuarios virtuales, con una utilización de memoria y CPU estable.
   - En ningún momento la latencia p95 superó los **120 ms**, muy por debajo del umbral contractual de 600 ms.

2. **Garantía de Exclusión Mutua Distribuida (RF-5.5 / RNF-08):**
   - La prueba de contención pura comprobó 4.653 batallas de concurrencia directa entre conductores. En **todas y cada una de las 4.653 carreras**, el mecanismo de bloqueo distribuido garantizó que **exactamente un conductor** obtuviera la confirmación (`200 OK`) y el viaje quedara asignado en exclusividad.
   - Los demás conductores recibieron inmediatamente `409 Conflict`, evitando duplicidad de viajes, sobre-asignaciones o condiciones de carrera silenciosas.

3. **Consistencia en la Máquina de Estados (RF-5.6):**
   - La prueba simultánea de cancelación del pasajero contra aceptación del conductor demostró un 100% de coherencia: cuando la cancelación ingresó primero, la solicitud pasó a `CANCELLED` y la aceptación fue rechazada (`409`); cuando la aceptación ingresó primero, el viaje quedó `ASSIGNED` y la cancelación posterior fue denegada (`409`). No existieron inconsistencias ni estados corruptos.

4. **Resiliencia Operativa:**
   - La tasa de errores de servidor HTTP 500 fue de **0%** a lo largo de las más de 74.000 solicitudes ejecutadas.

---

## 7. Instrucciones para Reproducir las Pruebas

Para reproducir los resultados en cualquier entorno con `k6` instalado:

### Opción A: Ejecutar la suite completa automatizada (inicia el servicio, ejecuta k6 y apaga):
```bash
cd modulo-5
npm run test:stress:all
```

### Opción B: Ejecutar escenarios individuales con el servicio activo:
1. Iniciar el servicio en una terminal:
   ```bash
   cd modulo-5
   $env:PORT="3005"; $env:AUTH_MODE="simulated"; $env:M4_MOCK="true"; npx ts-node src/index.ts
   ```

2. En otra terminal, ejecutar cualquiera de los comandos:
   ```bash
   # Escenario 1: Flujo completo (100 VUs)
   npm run test:stress

   # Escenario 2: Concurrencia de Aceptación (50 VUs)
   npm run test:stress:concurrency

   # Escenario 3: Carreras de Cancelación (50 VUs)
   npm run test:stress:cancellation
   ```
