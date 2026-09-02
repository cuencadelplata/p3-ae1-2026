# M7 - Tarifas, Pagos y Liquidaciones — RF-7.4 Cargo de cancelación

API en **TypeScript / Node.js / Express** que implementa el requerimiento
funcional **RF-7.4 (Cargo de cancelación)** del módulo M7, dentro del
escenario "Plataforma distribuida de movilidad urbana" (AE1).

Importante: la versión vigente de esta entrega es la 2.0.0 (incluye documentación OpenAPI/Swagger). La versión 1.0.0 quedó obsoleta y no debe usarse para evaluar el trabajo.

> El escenario no define las reglas reales de cálculo del cargo de
> cancelación, así que fueron **inventadas para esta entrega** y quedan
> documentadas en detalle en `src/cancellationService.ts`.

## Reglas de negocio (resumen)

| Situación | Cargo |

| Viaje aún "solicitado" (sin conductor asignado) | Gratis |
| Cliente cancela dentro de los 120s posteriores a la asignación (periodo de gracia) | Gratis |
| Cliente cancela pasado el periodo de gracia, conductor "asignado" | 20% de `estimatedFare`, entre $300 y $1500 ARS |
| Cliente cancela con conductor "en camino" o "arribado" | 50% de `estimatedFare`, entre $500 y $3000 ARS |
| Cancela el conductor | Sin cargo al cliente |
| Viaje "en_curso", "completado" o "cancelado" | Error de negocio (409) |

Multiplicador por vehículo: Auto = 1.0, Moto = 0.7.

## Endpoints

- `GET /health` → estado del servicio.
- `POST /api/m7/cargo-cancelacion` → calcula el cargo de cancelación.
- `GET /docs` → documentación interactiva (Swagger UI).
- `GET /openapi.json` → especificación OpenAPI en formato JSON.

## Documentación de la API (OpenAPI / Swagger)

La API está documentada con **OpenAPI 3.0**, definida en `openapi.yaml`
en la raíz del proyecto. Con la API corriendo (local o en Docker), la
documentación interactiva está disponible en:

http://localhost:3007/docs


Desde ahí se puede ver el contrato completo de cada endpoint (parámetros,
respuestas, códigos de error) y probar pedidos reales directamente desde
el navegador, sin necesidad de curl ni Postman.

---

## Cómo correr la simulación (Playwright)

La simulación de funcionamiento se implementó con **Playwright**, usando su
modo de API testing (`request`), que manda pedidos HTTP reales contra la
API y verifica con `expect(...)` que la respuesta sea la esperada. Los
escenarios están en `tests/cargo-cancelacion.spec.ts`.

Hay dos formas de correrla: manualmente contra la API que se levanta
(local o Docker), o de forma **totalmente automatizada end-to-end contra
el contenedor** con un solo comando.

### Opción A — end-to-end automático contra el contenedor 

```bash
npm run test:e2e
```

Este comando (`scripts/run-e2e.js`) hace todo el ciclo solo:
1. Construye la imagen Docker desde cero
2. Levanta un contenedor nuevo a partir de esa imagen
3. Espera activamente a que `/health` responda OK (hasta 30s)
4. Corre `npx playwright test` contra ese contenedor
5. Pase o falle el test, **siempre** apaga y borra el contenedor al final

No depende de que se levante nada a mano antes — es la forma formal de
correr un test end-to-end contra el artefacto real que se entrega
(la imagen Docker), no contra un proceso de Node suelto.

### Opción B — manual, contra la API ya levantada

**Con la API en local (Node):**

```bash
npm install
npm run build
npm start          # en una terminal, queda escuchando en :3007
```

En otra terminal:

```bash
npx playwright test
```

**Con la API en un contenedor ya levantado:**

```bash
docker run -d -p 3007:3007 --name m7-cargo-cancelacion m7-cargo-cancelacion
npx playwright test
```

### Qué cubre cada escenario

1. Viaje sin conductor asignado → gratis
2. Cancelación dentro del periodo de gracia (30s) → gratis
3. Cancelación pasado el periodo de gracia, Auto → cargo 20%
4. Igual al anterior, pero en Moto → cargo 20% × 0.7
5. Conductor ya arribado → cargo 50% (topeado por el máximo)
6. Cancela el conductor → sin cargo al cliente
7. Viaje ya completado → error de negocio (409)
8. Payload inválido (tarifa negativa) → error de validación (400)

---

## Ejecutar la API en local (sin Docker)

```bash
npm install
npm run build
npm start          # levanta en http://localhost:3007
```

## Construir y correr con Docker

```bash
docker build -t m7-cargo-cancelacion .
docker run -d -p 3007:3007 --name m7-cargo-cancelacion m7-cargo-cancelacion
curl http://localhost:3007/health
```

## Imagen publicada en Docker Hub

docker pull jazcha18/m7-cargo-cancelacion:2.0.0


https://hub.docker.com/r/jazcha18/m7-cargo-cancelacion

**Historial de versiones:**
- `1.0.0` — API inicial con RF-7.4 (sin documentación OpenAPI)
- `2.0.0` — Agrega especificación OpenAPI 3.0 y Swagger UI (`/docs`)

## Estructura del proyecto

cargo-cancelacion/
├── src/
│ ├── server.ts # Bootstrap de Express + Swagger UI
│ ├── types.ts # Tipos del dominio
│ ├── cancellationService.ts # Lógica de negocio de RF-7.4
│ └── routes/
│ └── cancellation.routes.ts # Endpoint POST /api/m7/cargo-cancelacion
├── tests/
│ ├── cargo-cancelacion.spec.ts # Simulación / tests con Playwright
│ └── cargo-cancelacion.custom.spec.ts # Test con valores por variables de entorno
├── scripts/
│ └── run-e2e.js # Orquesta el test E2E completo contra Docker
├── openapi.yaml # Especificación OpenAPI 3.0
├── playwright.config.ts
├── Dockerfile
├── .dockerignore
├── package.json
└── tsconfig.json