# Guía de pruebas de M8

Las pruebas se organizan por nivel y por requerimiento funcional. RF-8.1 cubre el procesamiento de notificaciones de viaje y RF-8.2 la generación y validación de QR temporales. La guía de casos concretos está en [CATALOGO_PRUEBAS.md](./CATALOGO_PRUEBAS.md).

## Niveles de prueba

### Unit

Las pruebas unitarias ejecutan módulos aislados, sin servidor HTTP, Docker ni navegador. Verifican validadores, servicios, configuración, generación de token/QR y almacenamiento temporal. La concurrencia y el uso único de RF-8.2 se comprueban especialmente en `tests/unit/qr/qr.store.test.ts`.

No verifican el enrutamiento Express, archivos públicos ni la integración real de los componentes.

### Integration

Las pruebas de integración crean la aplicación Express y consumen sus rutas con Supertest. Comprueban los contratos públicos de `POST /notifications`, `POST /qr` y `POST /qr/validate`, la composición de dependencias, validaciones y manejo uniforme de errores.

No levantan Docker ni un navegador. La concurrencia HTTP del QR también se verifica en `tests/integration/qr/qr.integration.test.ts`.

### E2E API

Las pruebas E2E API construyen una imagen Docker, levantan temporalmente el servicio M8 y consumen HTTP real con `fetch`. Cubren las rutas públicas de ambos RF y los recursos estáticos publicados por el servicio. El puerto del host es dinámico y el contenedor se elimina al finalizar.

No usan navegador ni reemplazan las operaciones públicas por acceso a estructuras internas.

### E2E UI

Las pruebas E2E UI usan Playwright con Chromium contra otro contenedor temporal del servicio M8. Recorren la interfaz de demostración, que realiza llamadas reales a `/notifications`, `/qr` y `/qr/validate`; no hay mocks de API ni esperas arbitrarias.

No intentan simular la entrega PUSH real ni esperan la expiración normal del QR.

## Comandos

| Comando | Alcance |
| --- | --- |
| `pnpm test` | Todas las pruebas unitarias y de integración. |
| `pnpm test:watch` | Unit e integración en modo observación. |
| `pnpm test:unit` | Todas las pruebas unitarias. |
| `pnpm test:unit:notifications` | Unit de RF-8.1. |
| `pnpm test:unit:qr` | Unit de RF-8.2. |
| `pnpm test:integration` | Todas las pruebas de integración. |
| `pnpm test:integration:notifications` | Integración de RF-8.1. |
| `pnpm test:integration:qr` | Integración de RF-8.2. |
| `pnpm test:coverage` | Unit e integración con cobertura V8. |
| `pnpm test:e2e:api` | E2E API con Docker y HTTP real. |
| `pnpm test:e2e:ui` | E2E UI con Docker, Chromium y Playwright. |
| `pnpm test:e2e` | Todas las pruebas E2E: API y UI. |

Antes de ejecutar el E2E UI por primera vez en un equipo, instalar Chromium con `pnpm exec playwright install chromium`. En CI de Ubuntu se instala con sus dependencias del sistema.

Las verificaciones técnicas habituales son `pnpm typecheck`, `pnpm typecheck:test` y `pnpm build`.
