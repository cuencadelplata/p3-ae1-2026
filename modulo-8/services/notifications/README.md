# Notifications Processing

## Responsabilidad y RF

Implementa RF8.1: procesa eventos de viaje ya ocurridos y genera una notificación `PUSH` con `MockPushProvider` en AE1. No entrega notificaciones reales ni implementa RF8.7.

## Ejecución desde `modulo-8/`

Requiere Node 24 y PNPM 10.33.0.

```powershell
pnpm --filter @m8/notifications-processing run build
pnpm --filter @m8/notifications-processing run test
pnpm --filter @m8/notifications-processing run start
docker build -f services/notifications/Dockerfile -t m8-notifications .
```

Usa `PORT` (3000 por defecto); Compose publica `3101`. Endpoints: `GET /health` y `POST /notifications`. El contrato canónico está en `../../openapi/notifications.openapi.yaml`.

No hay UI documental propia: no se crea un servidor adicional en AE1. AE2 debe definir delivery real, persistencia e idempotencia.
