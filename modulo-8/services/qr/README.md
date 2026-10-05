# Servicio QR (RF-8.2)

Genera y valida QR temporales de un solo uso asociados a un viaje. M8 emite, valida y consume
el QR; decidir el inicio del viaje y cambiar su estado corresponde a M6.

- Contrato HTTP: [`openapi/qr.openapi.yaml`](../../openapi/qr.openapi.yaml)
- Alcance, evidencias y pruebas de AE2: [`docs/ae2-rf82.md`](docs/ae2-rf82.md)
- Decisiones: [`docs/adr/ADR-001-qr-consumo-atomico-redis.md`](docs/adr/ADR-001-qr-consumo-atomico-redis.md)
- Nota para M6: [`docs/contrato-m6.md`](docs/contrato-m6.md)
- Bitácora de AE2: [`docs/bitacora-ae2.md`](docs/bitacora-ae2.md)

## Endpoints

| Ruta | Uso |
| --- | --- |
| `POST /qr` | Genera un QR para `tripId`: devuelve el token, el PNG como data URL y `expiresAt`. |
| `POST /qr/validate` | Valida y consume el QR (`tripId` y `token`). |
| `GET /health/live` | El proceso responde. No consulta Redis. |
| `GET /health/ready`, `GET /health` | Disponibilidad: 503 si Redis no responde en 2 s. |

Códigos, cuerpos y ejemplos: ver el contrato.

## Configuración

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `REDIS_URL` | obligatoria | `redis://` o `rediss://`. Si falta o es inválida, el proceso termina con un error. |
| `QR_TTL_SECONDS` | `300` | Vigencia del QR. |
| `QR_EXPIRED_GRACE_SECONDS` | `3600` | Tiempo que un QR vencido se conserva para responder 410; después responde 404. |
| `PORT` | `3000` | Puerto HTTP. Compose lo publica en `3103`. |

## Datos en Redis

Una clave hash por QR, `m8:qr:<sha256 del token>`, con `id`, `tripId`, `createdAt`,
`expiresAt` y `usedAt` en milisegundos desde epoch (sin `usedAt`: no usado). El TTL es el tiempo
que falta hasta `expiresAt` más el margen. El token en claro no se guarda. Las pruebas usan
`m8:qr:test:<uuid>:` y borran sólo ese prefijo.

## Observabilidad

Logs JSON, una línea por evento, con `correlationId` (header `X-Correlation-Id` recibido o
generado). Eventos: `qr.issued`, `qr.validated`, `qr.rejected` (con el motivo) y
`qr.store_unavailable`. No se registran el token, el cuerpo de las solicitudes ni los health
exitosos.

## Ejecutar y probar (desde `modulo-8/`)

Las pruebas de integración usan un Redis real en `redis://localhost:6379` (o `REDIS_URL`); sin
Redis fallan indicando cómo levantarlo.

```bash
docker compose up -d redis
pnpm install --frozen-lockfile
pnpm --filter @m8/qr run build
pnpm --filter @m8/qr run typecheck:test
pnpm --filter @m8/qr run test
REDIS_URL=redis://localhost:6379 PORT=3199 pnpm --filter @m8/qr run start
```

```powershell
docker compose up -d redis
pnpm install --frozen-lockfile
pnpm --filter @m8/qr run build
pnpm --filter @m8/qr run typecheck:test
pnpm --filter @m8/qr run test
$env:REDIS_URL = "redis://localhost:6379"; $env:PORT = "3199"; pnpm --filter @m8/qr run start
```

Con Docker (los mismos comandos en bash y en PowerShell):

```
docker compose up -d --build qr redis
docker compose logs qr
node --test --test-name-pattern="^QR se crea, valida y no se puede reutilizar$" tests/e2e/workspace-api.e2e.test.mjs
docker compose stop qr
```

Para consultar el estado: `curl http://localhost:3103/health/ready` en bash o
`Invoke-RestMethod http://localhost:3103/health/ready` en PowerShell.
