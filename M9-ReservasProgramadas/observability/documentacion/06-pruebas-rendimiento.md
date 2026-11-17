# 06 · Pruebas de rendimiento con Grafana k6

Scripts: `performance/k6/` (solo APIs de k6: `k6/http`, `k6/metrics`; sin módulos Node).
Runner: `scripts/run-k6.mjs` (imagen `grafana/k6:2.3.0` en la red Compose, o `--host-k6`).

## Cómo ejecutar (PowerShell, desde la raíz)

```powershell
npm run obs:up                 # o npm run local:up si no se quiere telemetría
npm run k6:smoke               # primero siempre el smoke local
$env:PROFILE="short"; npm run k6:load; Remove-Item Env:PROFILE   # perfil corto de bajo consumo
npm run k6:smoke:cloud         # resultados en Grafana Cloud k6 (token k6 requerido)
```

Variables: `BASE_URL`, `RUN_ID`, `PROFILE` (`standard`/`short`), `VUS`, `DURATION`,
`STRESS_STEPS`, `MODE=arrival`, `STRESS_RPS`, `SPIKE_VUS`, `ACTIVATION_TIMEOUT_SECONDS`, etc.
`BASE_URL` por defecto: `http://m9-reservas:3000` (DNS del servicio dentro de la red Compose)
o `http://localhost:3000` con `--host-k6`. _localhost_ dentro del contenedor k6 sería el propio
contenedor, no la PC ni M9.

## Escenarios

| Comando                  | Escenario            | Configuración por defecto                          | Qué mide                                                                                              |
| ------------------------ | -------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `k6:smoke`               | CRUD válido          | 2 VUs, 30 s                                        | Status, esquema y efectos: PROGRAMADA → modificada → CANCELADA persiste                               |
| `k6:load`                | Carga de referencia  | 10 VUs, 3 min (short 1 min)                        | Mezcla fija 70/30: GET id 55 %, listado 15 %, POST 15 %, PATCH 10 %, DELETE 5 %; datos propios por VU |
| `k6:stress`              | Estrés por VUs       | 5→10→25→50, sostenimiento y descenso (1 min/etapa) | Punto de incumplimiento y recuperación                                                                |
| `MODE=arrival k6:stress` | Estrés por tasa      | 10→25→50→100 RPS                                   | RPS objetivo; reportar `dropped_iterations` (límite del generador)                                    |
| `k6:spike`               | Pico                 | base 5, pico 50 VUs 30 s                           | Aumento brusco y recuperación                                                                         |
| `k6:cache`               | Caché frío/caliente  | 20 reservas, espera TTL (60 s)                     | `http_req_duration{phase:cold}` vs `{phase:warm}` + `m9_cache_requests_total`                         |
| `k6:concurrency`         | Contención           | 20 VUs, 200 ops sobre 3 reservas                   | 409 esperados aparte (`m9_expected_conflicts`); invariantes en teardown                               |
| `k6:activation`          | Activación asíncrona | 3 VUs × 2 reservas, timeout 120 s                  | HTTP, `m9_activation_resolution_seconds`, `m9_activation_success` por separado                        |

Thresholds iniciales (hipótesis, no SLA ni exigencia docente): p95 < 500 ms por operación
(listado < 800 ms), errores inesperados < 1 %, checks > 99 %. En estrés **no** se fuerza que
todos los escalones aprueben: un FAIL se conserva como resultado (el runner propaga el código
de salida de k6 y guarda el resumen igual).

## Datos de prueba y limpieza

- Fechas relativas al reloj de ejecución (CRUD: +2 días; activación: +15 s).
- `clienteId` ficticios derivados de `RUN_ID` (`performance/k6/lib/ids.js`); direcciones
  genéricas (“Origen k6 N”). Cada request lleva `x-correlation-id = RUN_ID-VU-iter-n`.
- `DELETE` es lógico: CANCELADA persiste y la tabla crece entre corridas. En la rama del merge
  `GET /reservas` es paginado (`page`/`pageSize`, 20 por defecto), así que k6 mide la página 1.
- Sin reintentos automáticos de POST (podrían duplicar reservas).
- Limpieza administrativa SOLO en entorno local aislado:

```powershell
npm run k6:cleanup -- smoke-20261116T210000          # dry-run: cuenta reservas del RUN_ID
npm run k6:cleanup -- smoke-20261116T210000 --confirm
```

Se niega a correr si `DATABASE_URL` no es local; borra solo reservas de esos clientes y sus
eventos Outbox/Inbox; no toca volúmenes.

## Registro de cada corrida

`performance/results/<escenario>-<RUN_ID>.json` (métricas completas de k6) y `.meta.json`
(versión de k6, parámetros, CPU/RAM del host, modo local/cloud, código de salida y
`generatorSharesMachineWithApp: true`: generador y aplicación comparten la misma PC, lo que
limita la carga máxima creíble).

## Resultados

| Fecha | Escenario | RUN_ID | Resultado                                                                                                                 |
| ----- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| —     | —         | —      | **Pendiente**: aún no se ejecutó k6 (Docker Desktop cerrado durante la implementación). No se informan cifras inventadas. |

Al ejecutar, completar esta tabla con: p95 por operación, tasa de errores, RPS alcanzado,
`dropped_iterations`, y en el informe separar **hechos medidos**, **hipótesis** y **límites**.
No afirmar un cuello de botella sin evidencia (p. ej. cruzar p95 de `GET /reservas` con
`m9_db_operation_duration_seconds{operation="reservation.list"}`).
