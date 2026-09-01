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

El token se generará mediante mecanismos criptográficamente seguros de `node:crypto`. No se utilizarán `Math.random()`, identificadores secuenciales ni valores construidos con información predecible del viaje.

## Representación QR

RF-8.2 debe producir una representación QR real, no solo un string denominado QR. Es probable que sea necesaria una dependencia pequeña y específica para transformar el token opaco en una imagen o Data URL QR.

La dependencia concreta no se elige ni instala en esta etapa. Antes de incorporarla se evaluarán mantenimiento, compatibilidad con TypeScript, alcance y necesidad real. La generación del token y las reglas de negocio seguirán siendo responsabilidad de M8.

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

No constituye todavía un esquema de base de datos. Se prefiere conservar `SHA-256(token)`, calculado con `node:crypto`, en lugar del token original cuando resulte razonable. No se agregará una dependencia externa para hashing.

M8 no deberá persistir innecesariamente el token original en texto plano. Cuando resulte razonable, conservará internamente únicamente su hash.

El token original será entregado durante la generación para poder construir, presentar y posteriormente validar el QR.

No debe incluirse innecesariamente en logs, URLs ni mensajes de error.

## Almacenamiento AE1

La decisión inicial es utilizar almacenamiento en memoria encapsulado si resulta coherente con el servicio M8 existente. Esta alternativa es transitoria: el estado se pierde al reiniciar el proceso y no debe presentarse como persistencia definitiva.

No se incorporarán PostgreSQL, Redis ni otra base de datos únicamente para RF-8.2 durante AE1. M8 será propietario lógico de los registros QR y no consultará tablas ni datos completos de M6.

## Uso único y concurrencia

Una validación exitosa consume el QR. Una segunda validación debe fallar.

La comprobación de vigencia, asociación con el viaje, uso previo y marcado como utilizado formarán una única operación lógica. Dos solicitudes concurrentes sobre el mismo QR no pueden terminar ambas exitosamente.

Para AE1, con una única instancia Node.js y almacenamiento en memoria, se aplicará la solución más simple que preserve esa propiedad. No se diseñará todavía una solución distribuida ni se incorporará Redis para anticipar etapas posteriores.

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

El contrato definirá categorías para entrada inválida, contenido no soportado, QR inexistente, asociación incorrecta, vencimiento, uso previo y error interno. Los códigos HTTP y el catálogo final se cerrarán en la especificación funcional y OpenAPI.

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
