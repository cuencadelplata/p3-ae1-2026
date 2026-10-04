# P3 — AE2 2026

Este branch contiene la evolución individual 2.0.0 de **M9 — Reservas Programadas**.
El módulo, sus comandos y su documentación ejecutable están en
[`M9-ReservasProgramadas/`](M9-ReservasProgramadas/README.md).

Comandos desde la raíz:

```bash
npm ci
npm run local:up
npm run verify
npm run test:coverage
npm run test:infrastructure
npm run test:e2e
```

Arquitectura y trazabilidad:

- [`docs/ae2-scope.md`](docs/ae2-scope.md)
- [`docs/traceability-matrix.md`](docs/traceability-matrix.md)
- [`docs/architecture-ae2.md`](docs/architecture-ae2.md)
- [`docs/testing-evidence.md`](docs/testing-evidence.md)
- [`docs/defensa-oral-ae2.md`](docs/defensa-oral-ae2.md)

No versionar `.env`, credenciales, `node_modules`, `dist`, `coverage` ni cachés. La base AE1
aceptada sigue `PENDIENTE_CONFIRMAR_BASE_AE1`; el tag observable es `v1.0.0`.
