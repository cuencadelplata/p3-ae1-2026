# QR Verification

## Responsabilidad y RF

Implementa RF8.2: genera QR temporales asociados a `tripId` y valida/consume tokens de un solo uso. El estado AE1 vive en memoria.

## Ejecución desde `modulo-8/`

Requiere Node 24 y PNPM 10.33.0.

```powershell
pnpm --filter @m8/qr run build
pnpm --filter @m8/qr run test
pnpm --filter @m8/qr run start
docker build -f services/qr/Dockerfile -t m8-qr .
```

Variables: `PORT` (3000 por defecto) y `QR_TTL_SECONDS` (300 por defecto). Compose publica `3103`. Endpoints: `GET /health`, `POST /qr` y `POST /qr/validate`. El contrato canónico está en `../../openapi/qr.openapi.yaml`.

No hay UI documental propia. AE2 debe definir almacenamiento temporal distribuido y consumo atómico entre instancias.
