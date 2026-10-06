# AE2 — Etapa 1: auditoría de arquitectura hacia una aplicación M8 única

**Rama auditada:** `integration/m8-ae2-unified`  
**Propósito:** identificar las brechas entre el estado integrado actual y el
objetivo AE2 de una única aplicación e imagen Docker de M8. Este documento no
implementa cambios ni reemplaza los contratos OpenAPI vigentes.

## Estado actual comprobado

El workspace contiene los paquetes internos siguientes:

```text
services/
├── notifications          RF8.1
├── qr                     RF8.2
├── receipts               RF8.3 y RF8.4
├── support                RF8.5
├── notification-delivery  RF8.7
└── shared                 componentes técnicos compartidos, incluido RF8.6
```

La separación interna por responsabilidad es útil y debe conservarse. Sin
embargo, la ejecución actual aún se organiza como varias aplicaciones HTTP:

| Componente | Arranque actual | Puerto Compose | Dependencias principales |
| --- | --- | --- | --- |
| Notifications | `services/notifications/src/server.ts` | 3101 | PostgreSQL |
| QR | `services/qr/src/server.ts` | 3103 | Redis |
| Receipts / Resend | `services/receipts/src/index.ts` | 3008 | PostgreSQL, Redis, RabbitMQ, M1, M7 y sandbox fiscal |
| Support | `services/support/src/index.ts` | 3000 | PostgreSQL y RabbitMQ |
| Notification Delivery | `services/notification-delivery/src/http/server.ts` | 3107 | PostgreSQL, RabbitMQ, M1, M2 y proveedor PUSH sandbox |

`compose.yaml` también construye una imagen por servicio. Por lo tanto, el
estado actual no cumple todavía el objetivo arquitectónico final de una única
aplicación M8 y una única imagen de aplicación.

Desde el commit `099ca41`, Receipts ya expone `createReceiptsModule()`. Este
adaptador entrega su router, checks, readiness, start y stop, y no abre un
puerto HTTP. Es la primera referencia concreta para la composición futura;
no cambia aún el despliegue actual de varios servicios.

## Infraestructura y propiedad de datos

La infraestructura ya sigue parcialmente el diseño AE2:

- existe una CommunicationsDB física basada en PostgreSQL;
- existen schemas y roles lógicos para Receipts, Notifications, Support y
  Notification Delivery;
- QR usa Redis para TTL, hash y consumo atómico;
- Receipts usa Redis para enlaces temporales;
- RabbitMQ utiliza la topología común `mobility.events` y
  `mobility.events.dlx`;
- los sandboxes fiscal, M1 y M7 están separados de la aplicación M8.

La consolidación no debe transformar Redis, RabbitMQ ni PostgreSQL en un medio
de acceso a datos de otros módulos. M8 solamente consulta M1, M2, M6 o M7 por
contratos HTTP documentados o eventos RabbitMQ acordados. Dentro de M8, cada
RF conserva ownership lógico de sus tablas, colas y prefijos Redis.

## Brechas técnicas detectadas

### Aplicación HTTP

- Cada RF tiene su propio punto de arranque y composición de dependencias.
- Notifications, QR, Receipts y Support usan Express; Notification Delivery
  expone actualmente un `http.RequestListener` de Node.
- No existe todavía un bootstrap único que inicialice recursos, monte rutas y
  gestione el apagado ordenado de todos los RF.

### Health y disponibilidad

- QR, Receipts, Support y Notification Delivery tienen variantes de
  `/health/live` y/o `/health/ready`.
- Notifications sólo expone `/health`.
- El objetivo común es una única superficie con `/health/live`,
  `/health/ready` y `/health` como alias de ready, informando `ok`,
  `degraded` o `unavailable`.

### Docker

- Notifications, QR y Notification Delivery usan Node 24 en sus Dockerfiles.
- Receipts y Support aún usan Node 22, lo que contradice la tecnología común
  acordada para AE2.
- Existen cinco Dockerfiles de aplicación y varias publicaciones de puertos.

### Contrato HTTP y documentación

- `openapi/m8-openapi.yaml` se define hoy como un índice de contratos de
  múltiples servidores y declara expresamente que no existe un gateway único.
- Support sirve documentación propia y los demás RF exponen contratos de forma
  independiente.
- Una aplicación única requiere revisar esa afirmación y definir una
  documentación consolidada sin modificar indebidamente los contratos de cada
  RF.

## Objetivo de migración

El resultado buscado es:

```text
               ┌────────────────────┐
HTTP ─────────▶│ Aplicación única M8 │
               │  Express / bootstrap│
               ├────────────────────┤
               │ RF8.1 Notifications│
               │ RF8.2 QR           │
               │ RF8.3 / 8.4 Receipts│
               │ RF8.5 Support      │
               │ RF8.6 Messaging    │
               │ RF8.7 Delivery     │
               └─────────┬──────────┘
                         │
      ┌──────────────────┼──────────────────┐
      ▼                  ▼                  ▼
 PostgreSQL            Redis            RabbitMQ
```

PostgreSQL, Redis, RabbitMQ y los sandboxes continúan como contenedores
separados. Sólo se consolida la aplicación Node.js de M8.

## Decisiones mínimas antes de implementar

1. Definir un bootstrap único que construya las dependencias de cada RF sin
   abrir puertos individuales.
2. Conservar los servicios, repositorios, validadores y contratos de cada RF;
   la consolidación debe cambiar composición y transporte HTTP, no reglas de
   negocio.
3. Adaptar Notification Delivery a un router o adaptador compatible con la
   aplicación Express común. No se debe exponer otro servidor HTTP.
4. Centralizar health y cierre ordenado, permitiendo que una dependencia caída
   se informe como `degraded` cuando el RF pueda seguir atendiendo.
5. Crear un Dockerfile multi-stage único con Node 24 y una sola imagen M8.
6. Reemplazar los cinco servicios de aplicación de Compose por un único
   servicio `m8-app`, manteniendo los contenedores de infraestructura y
   sandboxes.
7. Unificar la publicación de OpenAPI y documentación sólo después de fijar las
   rutas finales de la aplicación común.

## Orden recomendado de implementación

1. Diseñar y probar el bootstrap único usando Receipts como primer módulo
   montable, sin eliminar los entrypoints actuales.
2. Registrar rutas y dependencias de RF8.1 a RF8.7 en la aplicación común.
3. Incorporar el health global y pruebas de disponibilidad degradada.
4. Crear la imagen Node 24 única y migrar Compose a `m8-app`.
5. Ejecutar pruebas funcionales y E2E contra el contenedor consolidado.
6. Actualizar OpenAPI, documentación y runbook con el resultado real.
7. Ejecutar una reproducción limpia desde cero antes del cierre final.

## Criterio de salida de la etapa

La siguiente etapa puede comenzar cuando este plan sea aprobado. La migración
debe preservar las responsabilidades de los RF, no introducir acceso directo a
datos de otros módulos y no modificar el lifecycle de viajes administrado por
M6.
