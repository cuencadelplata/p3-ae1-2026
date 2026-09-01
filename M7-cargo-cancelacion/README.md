# M7 - Tarifas, Pagos y Liquidaciones — RF-7.4 Cargo de cancelación

API en **TypeScript / Node.js / Express** que implementa el requerimiento
funcional **RF-7.4 (Cargo de cancelación)** del módulo M7, dentro del
escenario "Plataforma distribuida de movilidad urbana" (AE1).

> El escenario no define las reglas reales de cálculo del cargo de
> cancelación, así que fueron **inventadas para esta entrega** y quedan
> documentadas en detalle en `src/cancellationService.ts`.

## Reglas de negocio (resumen)

| Situación - Cargo |

| Viaje aún "solicitado" (sin conductor asignado) - Gratis |
| Cliente cancela dentro de los 120s posteriores a la asignación (periodo de gracia) - Gratis |
| Cliente cancela pasado el periodo de gracia, conductor "asignado" - 20% de `estimatedFare`, entre $300 y $1500 ARS |
| Cliente cancela con conductor "en camino" o "arribado" - 50% de `estimatedFare`, entre $500 y $3000 ARS |
| Cancela el conductor - Sin cargo al cliente |
| Viaje "en_curso", "completado" o "cancelado" - Error de negocio (409) |

Multiplicador por vehículo: Auto = 1.0, Moto = 0.7.

## Endpoints

- `GET /health` → estado del servicio.
- `POST /api/m7/cargo-cancelacion` → calcula el cargo de cancelación.

---

## Cómo correr la simulación (Playwright)

La simulación de funcionamiento se implementó con **Playwright**, usando su
modo de API testing (`request`), que manda pedidos HTTP reales contra la
API y verifica con `expect(...)` que la respuesta sea la esperada. Los
escenarios están en `tests/cargo-cancelacion.spec.ts`.

Se puede correrla contra la API en local (con Node) o contra el contenedor
Docker — el procedimiento es el mismo, solo cambia cómo se levanta la API.

### Opción A — con la API corriendo en local (Node)

**1) Instalar dependencias (una sola vez):**

```bash
npm install
```

**2) Compilar el proyecto:**

```bash
npm run build
```

**3) Levantar el servidor** (dejar terminal abierta):

```bash
npm start
```

Se tiene que ver: `RF-7.4 Cargo de cancelacion escuchando en :3007`

**4) En OTRA terminal**, parado en la misma carpeta del proyecto, se deben correr los tests:

```bash
npx playwright test
```

Se tiene que ver algo como lo siguiente:

```
Running 8 tests using 1 worker
  8 passed (1.2s)
```

Si algún test falla, Playwright  muestra exactamente qué esperaba vs. qué recibió.

**Extra — reporte visual en el navegador:**

```bash
npx playwright test --reporter=html
npx playwright show-report
```

### Opción B — con la API corriendo en el contenedor Docker

**1) Levantar el contenedor** (si no está corriendo):

```bash
docker run -d -p 3007:3007 --name m7-cargo-cancelacion m7-cargo-cancelacion
```

**2) Correr los tests igual que antes:**

```bash
npx playwright test
```

Como el contenedor expone el mismo puerto `3007`, Playwright le pega
exactamente igual que si fuera la versión local — no hace falta cambiar
nada. Si el contenedor corriera en otro host/puerto, se puede indicar así:

```bash
BASE_URL=http://localhost:OTRO_PUERTO npx playwright test
```

(En Windows PowerShell: `$env:BASE_URL="http://localhost:OTRO_PUERTO"; npx playwright test`)

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

```
docker pull jazcha18/m7-cargo-cancelacion:1.0.0
```

https://hub.docker.com/r/jazcha18/m7-cargo-cancelacion

## Estructura del proyecto

```
cargo-cancelacion/
├── src/
│   ├── server.ts                     # Bootstrap de Express
│   ├── types.ts                      # Tipos del dominio
│   ├── cancellationService.ts        # Lógica de negocio de RF-7.4
│   └── routes/
│       └── cancellation.routes.ts    # Endpoint POST /api/m7/cargo-cancelacion
├── tests/
│   └── cargo-cancelacion.spec.ts     # Simulación / tests con Playwright
├── playwright.config.ts
├── Dockerfile
├── .dockerignore
├── package.json
└── tsconfig.json
```