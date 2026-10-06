# AE2 — Etapa 0: baseline técnico integrado

**Fecha de ejecución:** 2026-10-05 (America/Argentina/Buenos_Aires)  
**Rama auditada:** `integration/m8-ae2-unified`  
**Commit actualizado:** `099ca41 refactor(rf8.3): exponer receipts como modulo montable en la aplicacion comun de M8`  
**Objetivo:** registrar el estado reproducible previo a los cambios de cierre
arquitectónico de M8. Esta etapa no modifica código, contratos ni
infraestructura.

## Comandos ejecutados y resultados

### Estado de Git

```powershell
git status
git branch --show-current
```

Resultado:

```text
On branch integration/m8-ae2-unified
Your branch is up to date with 'origin/integration/m8-ae2-unified'.

nothing to commit, working tree clean
integration/m8-ae2-unified
```

La auditoría comenzó con el árbol de trabajo limpio y la rama sincronizada con
su remoto. Posteriormente se incorporó por avance rápido el commit `099ca41`;
los documentos de auditoría de estas etapas permanecen locales hasta su
revisión y no forman parte de ese commit.

### Instalación reproducible

```powershell
pnpm --dir modulo-8 install --frozen-lockfile
```

Resultado: finalizó correctamente (código de salida `0`). El lockfile estaba
actualizado y la instalación se realizó con `pnpm 10.33.0`, sin cambios de
resolución de dependencias.

### Compilación del workspace

```powershell
pnpm --dir modulo-8 run build
```

Resultado: finalizó correctamente (código de salida `0`). Compilaron sin
errores los servicios de Notifications, QR, Receipts, Shared, Support y
Notification Delivery.

### Suite de pruebas del workspace

```powershell
pnpm --dir modulo-8 run test
```

Resultado: finalizó correctamente (código de salida `0`). La ejecución
secuencial de las suites de Notifications, QR, Receipts, Shared, Support y
Notification Delivery no registró fallos. Entre las verificaciones observadas
se incluyen idempotencia, concurrencia, TTL, Redis, RabbitMQ, DLQ, health,
autorización y entrega PUSH simulada.

Una prueba condicional de infraestructura real de RF8.7 fue omitida porque la
instancia local de PostgreSQL no tenía inicializado el schema
`notification_delivery`. Esto no invalida las pruebas unitarias e integración
ejecutadas, pero deja pendiente comprobar ese flujo contra una
CommunicationsDB creada desde cero mediante Docker Compose.

Tras incorporar `099ca41`, se repitieron instalación reproducible,
compilación y la suite completa del workspace con resultado satisfactorio.
El cambio agrega el módulo montable de Receipts y su prueba unitaria, sin
alterar los resultados funcionales del workspace.

### Estado actual de Docker Compose

```powershell
docker compose -f modulo-8/compose.yaml ps
```

Resultado: los siguientes contenedores estaban activos y saludables durante
la auditoría:

```text
fiscal-sandbox
m1-identity-sandbox
m7-payments-sandbox
notifications
postgres
qr
rabbitmq
receipts
redis
support
```

Se verificaron como saludables PostgreSQL, Redis, RabbitMQ, Notifications,
QR, Receipts, Support y los sandboxes listados por Docker Compose.

El servicio `notification-delivery` no había sido creado ni iniciado en esta
sesión de Compose. Por ese motivo, esta Etapa 0 no constituye una validación de
su arranque dentro del entorno Docker; deberá comprobarse explícitamente en la
etapa de contenerización final.

## Conclusión del baseline

La rama integrada parte de un estado limpio, instalable, compilable y con la
suite de pruebas del workspace aprobada. La infraestructura actual contiene
PostgreSQL, Redis y RabbitMQ compartidos por M8, además de servicios y
sandboxes separados mediante Docker Compose.

Este documento es una referencia previa al cierre arquitectónico. En
particular, deja explícito que el estado actual todavía publica varios
contenedores de aplicación M8; la futura consolidación en una única
aplicación e imagen debe validarse contra este baseline sin perder las
funcionalidades existentes.

## Evidencia complementaria de CI

El workflow `M8 Workspace CI` asociado al commit `90403b5` finalizó en estado
`success`. El commit posterior `099ca41` también fue validado por CI en verde.
Las ejecuciones realizan instalación reproducible, build, typechecks, tests,
construcción de Compose, arranque de servicios, health checks y pruebas E2E en
un entorno limpio.

## Pendiente para la siguiente etapa

Validar desde cero el arranque de `notification-delivery` con
`M1_JWT_SECRET` y `M2_INTERNAL_API_KEY` configuradas externamente, sin usar
secretos reales en el repositorio.
