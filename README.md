git clone https://github.com/cuencadelplata/p3-ae1-2026.git
cd p3-ae1-2026/modulo6
npm ci
docker compose up -d --build
La aplicación y sus especificaciones OpenAPI se encuentran dentro de `modulo6`.
# p3-ae1-2026

Los tres grupos de requerimientos de M6 están integrados en [modulo6](modulo6/README.md), con un solo manifiesto npm, TypeScript, Vitest y Docker Compose.

```sh
cd modulo6
npm ci
npm test
npm run build
```

Consulta [la guía de modulo6](modulo6/README.md) para levantar el stack, ejecutar los E2E y encontrar las especificaciones OpenAPI.
