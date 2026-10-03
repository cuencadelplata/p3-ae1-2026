# Módulo 8 — Notificaciones, Documentos y Soporte

M8 reúne cuatro servicios HTTP independientes para AE1. No existe gateway:
cada servicio conserva su propio puerto y contrato.

| Servicio | Puerto | Alcance AE1 |
| --- | ---: | --- |
| Notifications | 3101 | RF-8.1, procesamiento PUSH mock. |
| QR | 3103 | RF-8.2, QR temporal de un solo uso. |
| Receipts | 3008 | RF-8.3 y RF-8.4, comprobantes PDF y reenvío simulado. En `ae2/juan-gualtieri`: versión 2.1.0 con PostgreSQL, RabbitMQ, Redis y autorizador fiscal simulado (`fiscal-sandbox`, puerto 4010) ([README](services/receipts/README.md)). |
| Support | 3000 | RF-8.5 y base parcial de integración RabbitMQ para RF-8.6. |

## Requisitos y uso

Node.js 24, PNPM 10.33.0 y Docker Compose.

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
docker compose build
docker compose up -d
pnpm run test:e2e
docker compose down --remove-orphans
```

`compose.yaml` inicia también RabbitMQ (puertos 5672 y 15672), PostgreSQL y Redis.
Receipts guarda sus datos en PostgreSQL (esquema `receipts`).

## Contratos y documentación

- El índice OpenAPI agregado está en `openapi/m8-openapi.yaml`; enumera los
  servicios sin fingir un endpoint único.
- Los contratos canónicos por servicio están en `openapi/`; consultar los
  runbooks de [Notifications](services/notifications/README.md),
  [QR](services/qr/README.md), [Receipts](services/receipts/README.md) y
  [Support](services/support/README.md).
- El estado explícito de RF8.1 a RF8.7 está en `docs/rf-status.md`.
- Los acuerdos y decisiones pendientes para coordinar AE2 están en
  [docs/ae2-intermodule-agreements.md](docs/ae2-intermodule-agreements.md).
- Cada servicio publica su propia UI Scalar: Support en `/api-docs` y Receipts
  en `/docs` (redirige a `/api/v1/docs`).
- El contrato RabbitMQ ejecutable de AE1 está en
  `contracts/events/rabbitmq-ae1.md`.
- La documentación histórica y de migración preservada está en `docs/`.
- `tests/e2e/` contiene la regresión API global; `.github/workflows/m8-ci.yml`
  ejecuta build, tests, Compose, health y esa suite en CI.

## Estado AE1 y siguiente etapa

Notifications conserva `PushProvider` y su mock; RF-8.7 no está completado.
Support implementa tickets en memoria y una base parcial de RabbitMQ para
RF-8.6; no existen retry, DLQ ni contratos de evento versionados. Persistencia
distribuida, Redis, proveedores reales y esos mecanismos pertenecen a AE2.
