# P3 — AE2 2026

Este branch contiene la evolución individual 2.0.0 de **M9 — Reservas Programadas**.
El módulo, sus comandos y su documentación ejecutable están en
[`M9-ReservasProgramadas/`](M9-ReservasProgramadas/README.md).

## Uso rápido desde la raíz

Requisitos: Node.js 22, npm y Docker Desktop iniciado. En PowerShell:

```powershell
npm ci
Copy-Item M9-ReservasProgramadas/.env.example M9-ReservasProgramadas/.env
npm run local:up
docker compose ps
```

Cuando todos los servicios estén iniciados:

- aplicación: `http://localhost:3000/`;
- Swagger UI: `http://localhost:3000/docs/`;
- OpenAPI: `http://localhost:3000/openapi.json`;
- estado del proceso: `http://localhost:3000/health`;
- disponibilidad de dependencias: `http://localhost:3000/readiness`.

La guía completa de configuración, uso del CRUD, activación programada, pruebas, cobertura,
simulación de fallos y limpieza está en el
[`README de M9`](M9-ReservasProgramadas/README.md).

Comandos principales desde la raíz:

```powershell
npm run verify
npm run test:coverage
npm run test:infrastructure
npm run test:e2e
npm run local:down
```

Documentación de entrega individual:

- [`entrega-ae2/Portafolio-Individual-AE2-M9-Ignacio-Parra.pdf`](entrega-ae2/Portafolio-Individual-AE2-M9-Ignacio-Parra.pdf)
- [`entrega-ae2/Bitacora del AE2.pdf`](entrega-ae2/Bitacora%20del%20AE2.pdf)
- [`entrega-ae2/Guia-Defensa-Oral-AE2-M9-Ignacio-Parra.docx`](entrega-ae2/Guia-Defensa-Oral-AE2-M9-Ignacio-Parra.docx)

No versionar `.env`, credenciales, `node_modules`, `dist`, `coverage` ni cachés. La referencia
técnica de AE1 es el tag `v1.0.0`; la evolución individual está en la rama
`ae2/parra-ingaramo-ignacio` y en el tag `v2.0.0`.
