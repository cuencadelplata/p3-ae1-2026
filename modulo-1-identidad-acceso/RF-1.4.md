# RF-1.4 Recuperación y revocación (Ana Paula Abelenda)

## Qué hace

Permite que un usuario que olvidó su contraseña recupere el acceso, y deja sin efecto las credenciales que ya no deberían servir.

Uso los dos backing services propios de M1:

- **Redis**: guardo el token temporal de recuperación con un tiempo de vida de 15 minutos. También guardo ahí la marca de revocación de cada usuario.
- **RabbitMQ**: publico un evento para que el servicio de notificaciones envíe el correo. M1 no manda el mail ni espera a que se mande.

## Endpoints

| Método y ruta | Qué hace | Respuestas |
|---|---|---|
| `POST /auth/solicitar-recuperacion` | Genera el token, lo guarda en Redis y publica el evento | 200, 400, 503 |
| `POST /auth/resetear-contrasena` | Cambia la contraseña con un token vigente | 200, 400, 401, 503 |
| `POST /auth/revocar-credenciales` | Deja sin efecto los JWT del usuario autenticado | 200, 401, 503 |

Las dos primeras rutas ya existían en AE1 y mantienen el mismo contrato, salvo `expiresInMinutes`, que pasó de 30 a 15. La tercera es nueva.

## Flujo

**1. El usuario pide recuperar la contraseña**

1. Valido el formato del email.
2. Verifico que Redis responda. Si no responde devuelvo 503.
3. Busco al usuario en la base de M1. Si no existe respondo 200 con el mismo mensaje de siempre, para no revelar qué emails están registrados.
4. Genero un token aleatorio de 64 caracteres.
5. Lo guardo en Redis con vencimiento de 900 segundos. Si el usuario ya tenía un token pendiente, lo borro.
6. Publico `auth.recuperacion_solicitada` en RabbitMQ y respondo 200 sin esperar.

**2. El servicio de notificaciones envía el correo** (fuera de M1). Lee el evento de su cola cuando puede y manda el mail con el token.

**3. El usuario cambia la contraseña**

1. Valido que vengan el token y una contraseña de al menos 6 caracteres.
2. Busco y borro el token en Redis en una sola operación. Si no está, respondo 401: nunca existió, ya se usó o pasaron los 15 minutos.
3. Guardo la contraseña nueva hasheada con bcrypt.
4. Revoco los JWT que el usuario tenía emitidos y publico `auth.credenciales_revocadas`.

## ¿Sincrónico o asincrónico?

Tiene una parte de cada una.

**Sincrónico: generar el token y cambiar la contraseña.** El usuario necesita saber en el momento si su pedido fue aceptado y si la contraseña cambió. Además el token tiene que estar guardado antes de responder, porque si no el usuario podría recibir un mail con un token que todavía no existe. Por eso Redis se consulta dentro del mismo request.

**Asincrónico: el envío del correo.** Mandar un mail es lento y depende de un servidor externo. Si M1 esperara a que se envíe, el usuario quedaría esperando y M1 dependería de que notificaciones esté funcionando. En cambio dejo el mensaje en RabbitMQ y respondo: notificaciones lo lee cuando quiera. Si está caído, el mensaje queda en su cola y el correo sale cuando vuelve.

El aviso de revocación también es asincrónico por el mismo motivo: a M1 no le interesa quién lo escucha.

## Qué guardo en Redis

| Clave | Valor | Vencimiento | Para qué |
|---|---|---|---|
| `recuperacion:token:<hash>` | id del usuario | 900 s | Saber de quién es el token |
| `recuperacion:usuario:<id>` | hash del token vigente | 900 s | Invalidar el token anterior si pide otro |
| `revocacion:usuario:<id>` | momento de la revocación (segundos) | 3600 s | Rechazar los JWT emitidos antes |

Decisiones que tomé:

- **Redis en lugar de la base de datos.** En AE1 el token se guardaba en una tabla con las columnas `expires_at` y `used`, y había que comparar fechas a mano. Un token de recuperación es un dato temporal: con el TTL Redis lo borra solo a los 15 minutos y no queda nada para limpiar.
- **Guardo el hash del token, no el token.** Si alguien pudiera leer Redis, con el hash no puede cambiar ninguna contraseña.
- **Un solo uso con `GETDEL`.** Lee y borra en una sola operación atómica. Si llegan dos pedidos al mismo tiempo con el mismo token, solo uno lo obtiene y el otro recibe 401.
- **La marca de revocación dura 1 hora** porque es lo que dura el JWT del login. Pasado ese tiempo los tokens viejos ya vencieron solos.

## Revocación

Hay dos tipos de credenciales que se revocan:

- **El token de recuperación**: deja de servir cuando se usa, cuando el usuario pide otro o cuando pasan los 15 minutos.
- **Los JWT de sesión**: dejan de servir cuando el usuario cambia la contraseña o cuando llama a `POST /auth/revocar-credenciales`.

Como un JWT no se puede "borrar", guardo en Redis el momento de la revocación. Un middleware compara ese momento con el campo `iat` del JWT (cuándo fue emitido): si el token es anterior, responde 401 `Credencial revocada`. El middleware está aplicado a todas las rutas de `/auth`, así que también lo respetan los otros módulos cuando validan un token con `GET /auth/validar-identidad-y-rol`.

Limitación conocida: el `iat` del JWT tiene precisión de segundos, así que un token emitido en el mismo segundo de la revocación sigue siendo válido.

## Eventos que publico

Uso el exchange de M1, `m1.eventos` (tipo `topic`, durable), con mensajes persistentes en JSON.

| Routing key | Cuándo se publica | Datos |
|---|---|---|
| `auth.recuperacion_solicitada` | Un usuario registrado pide recuperar la contraseña | `userId`, `email`, `nombre`, `token`, `expiraEnSegundos` |
| `auth.credenciales_revocadas` | Se cambia la contraseña o el usuario revoca sus credenciales | `userId`, `motivo`, `revocadasDesde` |

Ejemplo:

```json
{
  "id": "0b6f0c0e-7c1e-4b62-9a0e-3f2f3b6c9d11",
  "evento": "auth.recuperacion_solicitada",
  "modulo": "M1",
  "fecha": "2026-10-04T23:10:00.000Z",
  "datos": {
    "userId": 12,
    "email": "cliente@example.com",
    "nombre": "Ana",
    "token": "9f2c...(64 caracteres)",
    "expiraEnSegundos": 900
  }
}
```

- El evento lleva el email y el nombre porque notificaciones no puede consultar la base de M1: tiene que recibir todo lo que necesita para armar el correo.
- `id` es único por mensaje. RabbitMQ puede entregar un mensaje más de una vez, y con ese campo el consumidor evita mandar dos veces el mismo correo.
- `motivo` puede ser `CAMBIO_DE_CONTRASENA` o `SOLICITUD_DEL_USUARIO`.
- El módulo que consume crea su propia cola y la enlaza a `m1.eventos` con la routing key que le interese.

## Qué pasa si se cae un servicio

| Se cae | Qué pasa en RF-1.4 | El resto de M1 |
|---|---|---|
| Redis | No se pueden generar ni validar tokens de recuperación: responde 503. El control de revocación se omite y se deja pasar el pedido | Sigue funcionando |
| RabbitMQ | El pedido responde 200 igual. El evento de ese momento no se publica y el token vence solo en Redis. El usuario puede volver a pedirlo | Sigue funcionando |
| Notificaciones | A M1 no le afecta. Los mensajes quedan en la cola hasta que vuelva | Sigue funcionando |

Cuando Redis está caído respondo 503 para cualquier email, exista o no. Si respondiera distinto según el caso, se podría averiguar qué emails están registrados.

## Arquitectura en capas

Respeté las capas que ya tenía el módulo: cada una solo llama a la de abajo.

| Capa | Archivo | Qué hace |
|---|---|---|
| Rutas | `src/routes/auth.routes.ts` | Rutas de recuperación (ya existían) |
| Rutas | `src/routes/revocation.routes.ts` | Ruta de revocación y middleware para todo `/auth` |
| Middleware | `src/middleware/credential-revocation.middleware.ts` | Rechaza los JWT revocados |
| Controller | `src/controllers/recovery.controller.ts` | Recibe los pedidos de recuperación (ya existía) |
| Controller | `src/controllers/revocation.controller.ts` | Recibe el pedido de revocación |
| Servicio | `src/services/password-recovery.service.ts` | Lógica de recuperación |
| Servicio | `src/services/credential-revocation.service.ts` | Lógica de revocación |
| Repositorio | `src/repositories/recovery-token.repository.ts` | Token de recuperación en Redis |
| Repositorio | `src/repositories/credential-revocation.repository.ts` | Marca de revocación en Redis |
| Repositorio | `src/repositories/user.repository.ts` | Usuarios en la base de M1 (ya existía) |
| Mensajería | `src/messaging/recovery.publisher.ts` | Publica los eventos en RabbitMQ |
| Configuración | `src/config/redis.ts`, `src/config/rabbitmq.ts` | Conexiones del módulo (compartidas con RF-1.2) |

## Propiedad de los datos

- Solo leo y modifico datos de M1: la tabla `usuarios` a través de `user.repository.ts` y las claves de Redis de este RF.
- No consulto la base de ningún otro módulo, y ningún módulo consulta la de M1: lo que notificaciones necesita viaja en el evento.
- Uso el mismo Redis y el mismo RabbitMQ que el resto de M1 (uno de cada uno por módulo). Las claves de este RF empiezan con `recuperacion:` y `revocacion:` para no mezclarse con las del login.
- La tabla `password_recovery_tokens` de AE1 dejó de usarse.

## Qué cambió respecto de AE1

| | AE1 | AE2 |
|---|---|---|
| Dónde se guarda el token | Tabla en la base de datos | Redis con TTL |
| Duración | 30 minutos | 15 minutos |
| Envío del correo | M1 lo enviaba por SMTP dentro del request | M1 publica un evento y lo envía notificaciones |
| Uso único | Columna `used` | El token se borra al usarlo (`GETDEL`) |
| Revocación de sesiones | No había | Al cambiar la contraseña o a pedido del usuario |

## Tecnologías

- Node.js + TypeScript + Express.
- Redis 7 con la librería `ioredis`.
- RabbitMQ 3 con la librería `amqplib`.
- Vitest + Supertest para las pruebas, con `ioredis-mock` y un RabbitMQ simulado.

## Variables de entorno

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Conexión a Redis |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | Conexión a RabbitMQ |
| `RECUPERACION_TTL_SEGUNDOS` | `900` | Tiempo de vida del token de recuperación |

## Cómo probarlo

Levantar la API, Redis y RabbitMQ:

```bash
docker compose up -d --build
```

Para ver el evento hace falta una cola enlazada al exchange, que es lo que haría el servicio de notificaciones. En el panel de RabbitMQ (`http://localhost:15672`, usuario `guest`, contraseña `guest`):

1. Hacer un login o un pedido de recuperación para que M1 cree el exchange `m1.eventos`.
2. En **Queues and Streams**, crear una cola, por ejemplo `notificaciones.recuperacion`.
3. Entrar a la cola y en **Bindings** enlazarla al exchange `m1.eventos` con la routing key `auth.#`.

Después, desde PowerShell:

```powershell
# Pedir la recuperación (el email tiene que estar registrado)
Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/solicitar-recuperacion -ContentType "application/json" -Body '{"email":"cliente@example.com"}'

# Ver el token guardado en Redis y cuánto le queda
docker exec m1-redis redis-cli keys "recuperacion:*"
docker exec m1-redis redis-cli ttl "recuperacion:usuario:1"
```

En el panel, dentro de la cola, **Get messages** muestra el evento con el token. Con ese token:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/resetear-contrasena -ContentType "application/json" -Body '{"token":"PEGAR_TOKEN","newPassword":"NuevaClave123"}'
```

Si se repite el mismo pedido, responde 401 porque el token ya se consumió.

## Pruebas

```bash
npm test
```

| Archivo | Qué verifica |
|---|---|
| `tests/unit/recovery-token.repository.unit.test.ts` | TTL de 15 minutos, hash, uso único, token anterior invalidado, dos usos simultáneos |
| `tests/unit/credential-revocation.repository.unit.test.ts` | Marca de revocación y su vencimiento |
| `tests/unit/credential-revocation.service.unit.test.ts` | Qué tokens quedan revocados y evento publicado |
| `tests/unit/recovery.publisher.unit.test.ts` | Contenido de los eventos |
| `tests/integration/password-recovery.service.integration.test.ts` | Flujo completo por HTTP, vencimiento, concurrencia, Redis caído y RabbitMQ caído |
| `tests/integration/credential-revocation.middleware.integration.test.ts` | Rechazo de JWT revocados sin afectar al resto |
| `tests/integration/revocation.controller.integration.test.ts` | Endpoint de revocación |
| `tests/e2e/identidad-acceso.e2e.test.ts` (Flujo 5) | Flujo heredado de AE1, ahora tomando el token del evento |
