# M6 integrado

Los requisitos RF-6.1/6.2/6.3, RF-6.4/6.7 y RF-6.5/6.6 comparten un único proyecto Node, configuración de TypeScript/Vitest y stack Docker. Cada API conserva su límite y sus rutas.

## Requisitos

- Node.js 20 o superior y npm.
- Docker con Docker Compose para las pruebas E2E y los servicios de infraestructura.

## Instalar y probar

Desde esta carpeta:

```sh
npm ci
npm run docker:up
npm test
npm run build
npm run test:e2e
npm run docker:down
```

Las pruebas unitarias de RF-6.1/2/3 usan PostgreSQL y Redis reales, por eso se levantan con Compose. Para ejecutar una familia concreta:

```sh
npm run test:rf-6.1-6.2-6.3
npm run test:rf-6.4-6.7
npm run test:rf-6.5-6.6
```

`npm run test:e2e` requiere el stack en ejecución. También se puede seleccionar una familia con `test:e2e:rf-6.1-6.2-6.3`, `test:e2e:rf-6.4-6.7` o `test:e2e:rf-6.5-6.6`.

## Servicios

| Servicio | Puerto local | Responsabilidad |
| --- | ---: | --- |
| Viajes | 3000 | RF-6.1/6.2/6.3, persistencia y ciclo de vida |
| Cancelaciones | 3001 | RF-6.5/6.6, delega cambios a Viajes y publica eventos |
| Fachada | 3002 | RF-6.4/6.7, finalización e historial |
| PostgreSQL | 5432 | Base compartida `tripdb` |
| Redis | 6379 | Caché compartida |
| RabbitMQ | 5672, gestión 15672 | Eventos de viajes y cancelaciones |

Compose inicia un simulador interno para las dependencias M3/M4/M7/M8. Los tres servicios M6 comparten la misma imagen Node y la misma base; `docker compose down` detiene el entorno y conserva el volumen de PostgreSQL.

## Contratos

- Todos los requisitos: [OpenAPI consolidado](openapi.yaml)

## Estructura

```text
modulo6/
├── src/
│   ├── rf-6.1-6.2-6.3/
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── tests/
│   ├── rf-6.1-6.2-6.3/
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── tests-e2e/
│   ├── rf-6.1-6.2-6.3/
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── simulator/
│   ├── rf-6.1-6.2-6.3/   # mock M8
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── rf-6.1-6.2-6.3/   # SQL y documentación específica
├── rf-6.4-6.7/       # documentación específica
├── rf-6.5-6.6/       # contratos auxiliares y documentación
├── openapi.yaml      # especificación unificada de las tres APIs
├── docker-compose.yml
└── package.json
```