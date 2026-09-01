# Decisiones técnicas — M8 Grupo 6 — RF-8.2

## Propósito

Este documento registra las decisiones de arquitectura e implementación que condicionarán RF-8.2 — QR de verificación. La especificación funcional pertenece a `rf82-qr.md`, el contrato HTTP a `docs/api/openapi.yaml` y las evidencias de entrega a `entrega-ae1.md`.

## Integración dentro de M8

RF-8.2 no será un servicio, servidor ni proyecto independiente. Se integrará posteriormente con RF-8.1 dentro de M8 — Notificaciones, Documentos y Soporte, conservando una única API REST y una única imagen Docker.

RF-8.2 reutilizará la infraestructura compartida de M8 cuando corresponda:

- composición de la aplicación mediante `createApp`;
- Express y middleware común;
- `ApiError` y `errorHandler`;
- formato uniforme de errores;
- validación runtime;
- configuración externa;
- scripts de pnpm;
- Vitest, Supertest y la infraestructura E2E;
- Docker existente.

No reutilizará componentes propios del dominio de notificaciones, como `NotificationService`, `PushProvider` o `MockPushProvider`.

Las rutas de QR se montan mediante `registerQrRoutes(app)` (`qr.controller.ts`), pasado explícitamente a `createApp(registerQrRoutes)` desde `server.ts`, en vez de hardcodear el router dentro de `app.ts`. `createApp` ya expone un parámetro `registerRoutes` pensado exactamente para esto: si RF-8.2 hubiera montado su router directamente en `app.ts`, RF-8.1 habría necesitado tocar la misma línea para montar el suyo, generando un conflicto de merge evitable. `app.ts` queda sin ninguna referencia a QR.

## Stack

RF-8.2 mantiene la base tecnológica ya adoptada por M8:

- Node.js 24 LTS;
- TypeScript con configuración estricta y simple;
- Express;
- pnpm 10.33.0 como único gestor de paquetes;
- Vitest para pruebas;
- Supertest para integración HTTP;
- Docker.

No se utilizará npm ni se incorporarán tecnologías nuevas sin una necesidad concreta del requerimiento.

## Contract-First

Se mantiene el enfoque Design-First / Contract-First. `docs/api/openapi.yaml` será el contrato HTTP de la API M8 una vez revisado y aprobado.

RF-8.2 plantea inicialmente dos operaciones:

- `POST /qr`, para generar un QR asociado a un viaje;
- `POST /qr/validate`, para validar y consumir un QR.

Estas operaciones cubren la generación y la validación requeridas. No se agregarán endpoints CRUD, administrativos, de historial ni de consulta general de QR sin que un requerimiento los justifique.

## Separación de responsabilidades M6 / M8

M6 administra el ciclo de vida y los estados del viaje. M8 solo ofrece el mecanismo de verificación.

M8 genera el QR, controla su vencimiento, valida el token, controla el uso único y devuelve el resultado. M8 no inicia el viaje, no cambia su estado, no implementa `EN_CURSO` y no administra datos completos del viaje.

En la integración futura, M6 solicitará la generación y validación. Una respuesta válida de M8 permitirá que M6 decida si corresponde iniciar el viaje.

## Token opaco y contenido del QR

El contenido codificado por el QR será únicamente un token opaco. La asociación con el viaje existirá dentro de M8:

```text
token → tripId
```

El QR no codificará directamente `tripId`, identificadores de usuarios, datos personales, origen, destino, información financiera, credenciales ni información completa del viaje.

El token se genera con `crypto.randomBytes(32)` (256 bits de entropía) codificado en base64url (`Buffer.toString("base64url")`). El tamaño de 32 bytes es una elección conservadora: excede holgadamente lo necesario para un token de un solo uso con vigencia corta (minutos, según `QR_TTL_SECONDS`), y el costo adicional en el tamaño del QR resultante es irrelevante. Se prefirió base64url sobre hex (duplicaría el largo del token sin necesidad) y sobre base64 estándar (usa `+`, `/` y padding `=`, no aptos sin escape en una URL); el resultado son 43 caracteres alfanuméricos más `-`/`_`, sin padding. No se utilizó `Math.random()`, identificadores secuenciales ni valores construidos con información predecible del viaje.

## Representación QR

RF-8.2 produce una representación QR real, no solo un string denominado QR. Se agregó `qrcode` (npm) exclusivamente para esta responsabilidad.

Se evaluó también `qrcode-generator` como alternativa, más liviana y con tipos de TypeScript propios. No se eligió porque su método de generación de Data URL produce un GIF (`data:image/gif;base64,...`), verificado en el código fuente publicado de la librería, no un PNG — no cumple el pattern `^data:image/png;base64,` que exige el schema `QrDataUrl` del contrato. Adaptarla habría implicado tomar su matriz QR cruda y escribir un encoder PNG propio, lo cual contradice el criterio de usar una dependencia específica y de alcance reducido en lugar de reimplementar lo que ya resuelve una biblioteca madura.

`qrcode` no trae sus propios tipos de TypeScript; se agregó `@types/qrcode` como dependencia de desarrollo. No tiene dependencias nativas ni binarios; sus dependencias transitivas (`pngjs`, `dijkstrajs`, `yargs`) son JavaScript puro.

El nivel de corrección de errores (`errorCorrectionLevel`) se fija explícitamente en `"M"` en la llamada a `qrcode`, en vez de dejarlo implícito en el valor por defecto de la librería, para que la elección quede documentada en el propio código y no dependa de conocer el comportamiento por defecto de una versión particular de la dependencia.

La generación del token y las reglas de negocio siguen siendo responsabilidad de M8; `qrcode` solo transforma el token ya generado en una imagen.

`jsqr` y `pngjs` se agregaron como `devDependencies` exclusivas de test (no entran en la imagen de producción), para verificar por decodificación real que el QR generado contiene únicamente el token opaco.

## Temporalidad y configuración

La vigencia es controlada por M8 mediante la variable de entorno `QR_TTL_SECONDS`. El valor de desarrollo propuesto es `300` segundos.

El consumidor no podrá elegir arbitrariamente la duración de un QR. La configuración se validará según la estrategia de configuración existente del servicio y no se hardcodearán secretos ni valores sensibles.

## Modelo interno y hash

El modelo conceptual mínimo de un QR es:

- `id`;
- `tripId`;
- `tokenHash`;
- `createdAt`;
- `expiresAt`;
- `usedAt`.

No constituye todavía un esquema de base de datos. Se conserva `SHA-256(token)` en lugar del token original: `crypto.createHash("sha256").update(token).digest("hex")`, representado como 64 caracteres hexadecimales. No se agregó ninguna dependencia externa para hashing. El `id` del registro se genera con `crypto.randomUUID()`, nativo de Node, sin agregar dependencias.

M8 no deberá persistir innecesariamente el token original en texto plano. Cuando resulte razonable, conservará internamente únicamente su hash.

El token original será entregado durante la generación para poder construir, presentar y posteriormente validar el QR.

No debe incluirse innecesariamente en logs, URLs ni mensajes de error.

## Almacenamiento AE1

La decisión inicial es utilizar almacenamiento en memoria encapsulado si resulta coherente con el servicio M8 existente. Esta alternativa es transitoria: el estado se pierde al reiniciar el proceso y no debe presentarse como persistencia definitiva.

No se incorporarán PostgreSQL, Redis ni otra base de datos únicamente para RF-8.2 durante AE1. M8 será propietario lógico de los registros QR y no consultará tablas ni datos completos de M6.

## Uso único y concurrencia

Una validación exitosa consume el QR. Una segunda validación falla.

La comprobación de vigencia, asociación con el viaje, uso previo y marcado como utilizado forman una única operación lógica (`consumeIfValid`, en el store), que evalúa las condiciones en este orden de precedencia porque los casos pueden solaparse:

`NOT_FOUND` → `TRIP_MISMATCH` → `ALREADY_USED` → `EXPIRED`

Un QR ya utilizado y además vencido se reporta como `ALREADY_USED`, no como `EXPIRED`: el consumo es definitivo y es la causa más precisa. Hacia afuera, `TRIP_MISMATCH` se expone con el mismo código que un token inexistente, `404 QR_NOT_FOUND`, para no revelar que el token existe pero pertenece a otro viaje.

El vencimiento es inclusivo: un QR se considera vencido cuando `now >= expiresAt`, no solo cuando `now > expiresAt`.

Para AE1, con una única instancia Node.js y almacenamiento en memoria, la atomicidad se garantiza por diseño: `consumeIfValid` es completamente síncrona, sin `await` ni callback entre la comprobación de estado y la marca de `usedAt`. Como Node ejecuta JavaScript en un único hilo, una función síncrona corre hasta el final sin que otra solicitud pueda intercalarse en el medio; no existe ventana de carrera posible dentro de esa función. Esta garantía se verificó de forma directa: se rompió deliberadamente la atomicidad de manera temporal (haciendo la función asíncrona con un punto de cesión antes de marcar `usedAt`) y el test de concurrencia HTTP detectó la rotura de inmediato (10 de 10 validaciones concurrentes exitosas en vez de 1 de 10); el cambio se revirtió por completo antes de continuar.

Esta garantía es válida específicamente para este diseño — una sola instancia, estado en memoria, sección crítica sin puntos de cesión — y no se generaliza sola. Si en una etapa posterior el store pasa a una base de datos o el servicio corre en múltiples instancias, la misma propiedad deberá resolverse explícitamente con transacciones o una operación de actualización condicional (por ejemplo, un `UPDATE ... WHERE usedAt IS NULL` o equivalente), no asumirse por herencia del diseño actual de AE1.

## Errores y validación

RF-8.2 reutilizará `ApiError`, `errorHandler` y el formato de error de M8:

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "details": []
  }
}
```

El contrato define categorías para entrada inválida, contenido no soportado, QR inexistente, asociación incorrecta, vencimiento, uso previo y error interno, cerradas en `docs/api/openapi.yaml`.

### Capas y manejo de errores

El store (`qr.store.ts`) devuelve únicamente valores de dominio neutros (`NOT_FOUND`, `TRIP_MISMATCH`, `ALREADY_USED`, `EXPIRED`, `OK`), sin ningún conocimiento de HTTP. El service (`qr.service.ts`) traduce esos valores directamente a `ApiError` y los lanza; no hay una capa intermedia de resultado neutro entre el service y el controller. El store necesita mantenerse desacoplado de HTTP porque no es su responsabilidad, pero el service es exactamente la capa cuyo trabajo es traducir dominio a contrato HTTP: agregar ahí un tercer tipo de resultado, solo para que el controller lo vuelva a traducir a `ApiError`, habría sido la capa adicional que este mismo documento pide evitar cuando no resuelve un problema real.

### Desajuste conocido con el errorHandler compartido

`errorHandler` (compartido con RF-8.1) devuelve `INTERNAL_SERVER_ERROR` para cualquier error no controlado que no sea `ApiError` ni un JSON malformado — código que no forma parte del enum `ErrorCode` de `docs/api/openapi.yaml`, el cual solo define `QR_PROCESSING_ERROR` (y `NOTIFICATION_PROCESSING_ERROR` para RF-8.1) para el caso 500. RF-8.2 evita depender de ese fallback genérico: el único punto real de fallo inesperado en la generación (la llamada a `qrcode`) se envuelve explícitamente en `ApiError(500, "QR_PROCESSING_ERROR", ...)`. El desajuste en sí — que `errorHandler` no sepa producir un código del enum ante un error verdaderamente no anticipado — no se resolvió en este bloque porque `errorHandler` es un archivo compartido con RF-8.1; queda pendiente para resolverse en conjunto al integrar ambos requerimientos.

## Testing

Se mantendrá Vitest para pruebas unitarias y Supertest para integración HTTP. Las pruebas E2E contra Docker se incorporarán cuando aporten evidencia del flujo completo.

La estrategia deberá cubrir especialmente temporalidad, uso único y concurrencia, además de los contratos HTTP definidos. La temporización de pruebas deberá ser determinista, sin esperas reales largas.

## Docker e integración futura

RF-8.2 utilizará el Dockerfile, imagen y configuración de ejecución del servicio M8. No se creará otra imagen o contenedor exclusivo para QR.

Al integrar RF-8.1 y RF-8.2, se conservarán el servidor, infraestructura y convenciones compartidas. La integración agregará rutas, schemas y componentes QR de forma compatible, sin alterar el comportamiento existente de notificaciones.

## Tecnologías diferidas

No forman parte de RF-8.2 en AE1:

- RabbitMQ;
- Redis;
- base de datos adicional;
- autenticación propia;
- infraestructura distribuida.

## Principios de diseño

La implementación priorizará responsabilidad única, alta cohesión, bajo acoplamiento y separación entre HTTP y reglas de negocio.

SOLID se aplicará cuando resuelva una necesidad concreta. No se impondrán repository pattern, factories, strategies, interfaces o capas adicionales si no simplifican el problema actual ni aportan testabilidad o desacoplamiento real.
