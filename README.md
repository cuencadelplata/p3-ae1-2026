# AE2 · Módulo 2 Clientes · RF-2.2 Direcciones frecuentes

Evolución del ZIP recibido: conserva **RF-2.4 Calificación del conductor** e incorpora **RF-2.2: registrar orígenes/destinos favoritos o recientes**, según AE2 página 27. La base recibida no contenía RF-2.2 ni el sistema completo.

## Con y sin Internet (v2.2.0)

El recorrido se ejecuta con servicios locales. Se agregó consulta directa de RF-2.2 a M6, además del flujo por RabbitMQ. Preparar una vez con `node scripts/offline.cjs prepare`; arrancar sin descargas con `node scripts/offline.cjs start`. Ver [guía completa sin Internet e integración M6](docs/SIN-INTERNET.md).

## Reutilización de M6 y sugerencias

RF-2.2 usa el mismo cliente HTTP de RF-2.4. Importa un viaje con `POST /api/v1/direcciones/desde-viaje` y consulta `GET /api/v1/direcciones/sugerencias`: si el viaje fue A → B, propone B como origen y A como destino. Ambas direcciones pueden cambiarse. Acepta direcciones como texto, sin exigir coordenadas ni fecha de finalización. Ver [conexión al M6 real](docs/INTEGRACION-M6.md).

## Qué incluye

- Crear, consultar, filtrar, editar y eliminar direcciones propias; promover recientes a favoritas.
- PostgreSQL/Prisma, migraciones versionadas y restricción única por cliente, tipo y lugar (coordenadas cuando existen; texto normalizado cuando no).
- Redis con TTL de 60 segundos, invalidación por revisión durable y modo degradado.
- RabbitMQ: `TripCompleted.v1` de M6 → recientes de M2; `FavoriteAddressChanged.v1` de M2 → bandeja simulada de M8.
- Outbox transaccional, inbox, deduplicación por viaje, confirmación de publicación, ack después del commit, tres reintentos y DLQ.
- Idempotencia HTTP, control de concurrencia con `If-Match`, validación y aislamiento entre clientes.
- Adaptador de mapas por HTTP con timeout y simuladores separados de M4, M6 y M8.
- Contratos OpenAPI, pruebas, decisiones de arquitectura, trazabilidad del ZIP y guía de demostración.

**Estado de verificación:** consultar [resultados actualizados](docs/PRUEBAS.md). El servidor M6 de los compañeros no se ha probado: falta su URL accesible y confirmar el GET heredado contra ese servidor.

## Iniciar desde cero

Requisitos: Node.js 22 o superior, Docker Desktop/Engine iniciado y Docker Compose v2. Puertos libres: 3000, 4000, 4004, 4008, 55432, 56379, 56729 y 15679. Todo se expone sólo en localhost.

```bash
node scripts/setup.cjs
docker compose up --build -d
docker compose ps
```

`setup` crea `.env` con claves aleatorias y no pisa uno existente. **No subir `.env`**. El servicio `migrate` debe finalizar con código 0; aplica migraciones antes de iniciar M2. Las imágenes se descargan al construir. No hace falta iniciar servicios manualmente fuera de Compose.

- API: `http://localhost:3000`
- Liveness: `http://localhost:3000/health/live`
- Readiness: `http://localhost:3000/health/ready`
- Contrato: `http://localhost:3000/openapi.json`
- RabbitMQ Management: `http://localhost:15679` (usuario `ae2`, clave `RABBITMQ_PASSWORD` de `.env`).

Para generar un token sin instalar dependencias en el host:

```bash
docker compose exec -T api node scripts/token.cjs cliente-123
```

Copiar el resultado como `Authorization: Bearer <token>` en Postman/cliente REST. Es válido por una hora. **Identidad de demostración:** firma HMAC validada por M2; no es JWT ni una implementación completa de M1/OIDC. No se acepta `clienteId` del body ni un header manipulable como identidad. Para integrar M1 real, reemplazar el adaptador de autenticación manteniendo `res.locals.clienteId`.

## Endpoints propios

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/api/v1/direcciones` | Alta de favorita o promoción de reciente |
| GET | `/api/v1/direcciones` | Lista propia con filtros y paginación |
| GET | `/api/v1/direcciones/{id}` | Detalle y ETag |
| PATCH | `/api/v1/direcciones/{id}` | Etiqueta y/o estado favorito |
| DELETE | `/api/v1/direcciones/{id}` | Eliminar dirección propia |
| GET | `/api/v1/direcciones/sugerencias` | Candidatos para ambos extremos y regreso B → A |
| POST | `/api/v1/direcciones/desde-viaje` | Recupera recientes consultando M6 por viajeId |
| GET | `/api/v1/geocodificacion?q=Plaza` | Buscar en M4 simulado |

Todas requieren Bearer. Las escrituras de favoritos requieren `Idempotency-Key` (8–100 caracteres alfanuméricos, guion o guion bajo); PATCH/DELETE además requieren `If-Match: "1"` con la versión actual. Reutilizar una clave con otro cuerpo devuelve 409. La repetición válida devuelve la respuesta original y `Idempotency-Replayed: true`.

Body de POST:

```json
{
  "tipo": "ORIGEN",
  "etiqueta": "Casa",
  "direccion": "Plaza 25 de Mayo, Resistencia",
  "latitud": -27.4513,
  "longitud": -58.9866
}
```

Filtros: `?favorita=true`, `?recientes=true`, `?tipo=DESTINO&page=1&limit=20`. Máximo 100 resultados por página. Una misma dirección puede ser favorita y reciente. La identidad usa coordenadas a seis decimales si existen; en direcciones textuales normaliza mayúsculas, espacios y Unicode, sin equiparar domicilios semánticamente. Las coordenadas son opcionales y deben venir ambas o ninguna. Editar cambia etiqueta/favorita; para cambiar coordenadas se crea otra dirección.

## Integración con los otros módulos

| Módulo | Interacción | Estado incluido |
|---|---|---|
| M1 Identidad | Identidad firmada del cliente | Adaptador local de demo; no servidor M1 |
| M4 Ubicación | `GET /api/v1/geocodificacion?q=...` | Simulador HTTP con tres lugares de Resistencia |
| M6 Viajes | Publica `TripCompleted.v1` con cliente, origen y destino | Simulador HTTP publicador; datos de viajes en memoria |
| M6 Viajes | `GET /api/viajes/{viajeId}` | RF-2.4 e importación de recientes RF-2.2 |
| M8 Comunicaciones | Consume `FavoriteAddressChanged.v1` | Bandeja local persistida; no envía email/SMS reales |

Para registrar recientes automáticamente, M6 publica el evento al completar un viaje. Además, `POST /api/v1/direcciones/desde-viaje` permite consultar el endpoint existente `GET /api/viajes/{viajeId}` de M6, usando origen y destino textuales del contrato recibido. completadoAt y coordenadas no son obligatorios. Esta operación es idempotente por viajeId y no requiere Idempotency-Key. El endpoint `POST http://localhost:4000/demo/viajes/completados` sirve exclusivamente para demostrar ese productor. Envía el contenido de `docs/ejemplo-trip-completed.json` y `x-service-key: <INTEGRATION_SECRET>`. M2 nunca confía en direcciones o estados de viaje enviados por el cliente: la importación REST los verifica con M6.

Se propusieron contratos de demostración inicialmente. El contrato M6 recibido después permitió adaptar sus campos textuales; su GET y los eventos aún deben verificarse con el servidor/documentación efectiva. Están en [openapi-integraciones.json](docs/openapi-integraciones.json); los eventos, productores y consumidores en [EVENTOS.md](docs/EVENTOS.md). Ajustar los adaptadores si los otros integrantes usan otros nombres o rutas.

## Pruebas

Con dependencias Node locales:

```bash
npm ci
npm test
npm run test:integration
npm run test:stack
```

`test:integration` necesita la DB migrada y Redis de Compose; inicia su propia API en un puerto libre, con simulación HTTP para calificaciones y el simulador M4 real. Usa clientes de prueba únicos y **no limpia ni trunca tablas compartidas**. `test:stack` necesita todos los servicios, prueba los dos recorridos RabbitMQ, deduplicación de M8 y DLQ. Se recomienda un entorno exclusivo de pruebas porque ambos comandos generan datos identificados como `test-*`/`stack-*`.

Sin npm en el host:

```bash
docker compose exec -T api node --test tests/unit.test.cjs
docker compose exec -T api node --test --test-concurrency=1 tests/integration.test.cjs
docker compose exec -T -e TEST_API_URL=http://api:3000 -e M8_BASE_URL=http://m8:4008 api node --test tests/stack.test.cjs
```

La segunda prueba crea procesos simulados dentro del contenedor de prueba; no afecta los simuladores normales de Compose. Para pruebas de degradación y la defensa, seguir [DEMO.md](docs/DEMO.md).

## Uso local sin contenerizar M2

```bash
npm ci
docker compose up -d postgres redis rabbitmq m4 m6 m8
npm run db:migrate
npm run build
npm start
```

En otra terminal ejecutar `npm run worker`. `.env` generado ya apunta a los puertos del host. `npm run dev` inicia Node con vigilancia del código compilado; volver a compilar para aplicar cambios TypeScript.

## Base AE1 existente

La base original usaba `prisma db push`. Para una DB vacía, `migrate deploy` aplica ambas migraciones. Para una DB existente que contenga **exactamente** la tabla `calificaciones` del esquema original, verificar previamente ese esquema y registrar la base antes de migrar:

```bash
npx prisma migrate resolve --applied 202610050001_base_ae1
npm run db:migrate
```

No ejecutar esa resolución sobre una DB vacía ni sobre esquemas diferentes. No se suministra ni sobrescribe la DB original. Las migraciones agregan tablas propias; no borran calificaciones.

## Alcance académico y entrega

El alcance es RF-2.2 de M2. QR de inicio, pasarela/pagos y comprobante PDF pertenecen a M6/M7/M8 y **no están implementados** aquí. Su exclusión del alcance individual debe quedar validada por la cátedra; no se presenta este proyecto como cumplimiento del escenario global completo. El mapa sí está simulado por ser pertinente a direcciones.

Faltan datos que no estaban en el ZIP: URL del repositorio, tag/commit oficial AE1, branch nominal del alumno, issues reales, commits propios, aprobación del alcance y reflexión personal. No se inventaron. [ALCANCE.md](docs/ALCANCE.md), [TRAZABILIDAD.md](docs/TRAZABILIDAD.md) y [PORTAFOLIO.md](docs/PORTAFOLIO.md) permiten completarlos con evidencia real.

Tecnología: TypeScript/Express/Prisma heredados; Node 22; PostgreSQL 15; Redis 7; RabbitMQ 4. La aplicación de ejemplo usa HTTP local. Una publicación requeriría TLS y reemplazar la identidad y los simuladores por las integraciones del equipo.
