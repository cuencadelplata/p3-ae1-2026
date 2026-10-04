# RF-1.2 Autenticación (Franco Kaposvari)

## Qué hace

El usuario inicia sesión con email y contraseña en `POST /auth/iniciar-sesion`. La contraseña se valida contra la base de datos de M1 y, si es correcta, se devuelve un token JWT con `{ userId, role }`.

Para proteger el login se usan dos backing services propios de M1:

- **Redis**: guarda la cantidad de intentos fallidos por IP. Si una IP llega a 5 fallos en 60 segundos, cualquier nuevo intento se rechaza con `429 Too Many Requests` y el header `Retry-After`, sin consultar la base.
- **RabbitMQ**: M1 publica eventos para que otros módulos se enteren de lo que pasó en el login, sin que M1 tenga que esperarlos.

## ¿Sincrónico o asincrónico?

El requerimiento tiene una parte de cada una.

**Sincrónico: la autenticación y el control de intentos.** El cliente necesita la respuesta para continuar: sin el token no puede usar el sistema. Por eso la validación de la contraseña y la consulta a Redis se hacen dentro del mismo request, y la API responde 200, 401 o 429 en ese momento.

**Asincrónico: los eventos hacia otros módulos.** M1 publica el evento en RabbitMQ y responde al usuario sin esperar a que alguien lo procese. Cada módulo interesado (por ejemplo M8 Notificaciones, para avisar de un bloqueo por seguridad) lee la cola cuando quiere. Así M1 no depende de que el otro módulo esté funcionando.

## Eventos que publica M1

Exchange: `m1.eventos` (tipo `topic`, durable). Los mensajes son persistentes y en formato JSON.

| Routing key | Cuándo se publica | Datos |
|---|---|---|
| `auth.login_exitoso` | Un usuario inicia sesión correctamente | `userId`, `role` |
| `auth.ip_bloqueada` | Una IP llega al límite de intentos fallidos | `ip`, `intentos`, `bloqueadaPorSegundos` |

Ejemplo de mensaje:

```json
{
  "evento": "auth.login_exitoso",
  "modulo": "M1",
  "fecha": "2026-10-04T15:30:00.000Z",
  "datos": { "userId": 12, "role": "CLIENTE" }
}
```

El módulo que quiera escuchar estos eventos crea su propia cola y la enlaza al exchange `m1.eventos` con la routing key que le interese. Ningún módulo consulta la base de datos de M1.

## Integración con otros módulos

- **userId como identificador global**: el `userId` que genera M1 (el `id` de la tabla `usuarios`) identifica a la persona en todo el sistema, sea CLIENTE, CONDUCTOR u OPERADOR. Siempre viaja como **número entero**: en la base, en el JWT y en los eventos de RabbitMQ.
- **Cómo lo obtiene otro módulo**: con el token del usuario, llamando a `GET /auth/validar-identidad-y-rol` con el header `Authorization: Bearer <token>`. La respuesta es `{ valid, userId, role }`. Si el token no es válido, responde 401.
- **M2 (Perfiles)**: guarda el `userId` de M1 en su tabla de perfiles (columna `usuario_identidad_id`, relación 1 a 1) y crea el perfil solo si el token es válido. Solo guarda los datos adicionales del perfil: nombre, apellido, DNI, teléfono y email ya están en M1.
- **M8 (Notificaciones)**: usa el `userId` como `recipientId`, el destinatario de las notificaciones. Para la entrega actual (notificaciones PUSH) no necesita datos de contacto de M1.
- **Email**: es único en M1 y se guarda en minúsculas. M1 no expone un endpoint para consultar usuarios por email ni por id.

## Qué pasa si se cae un servicio

- **Si se cae Redis**: el login sigue funcionando, pero sin límite de intentos. El error queda en la consola.
- **Si se cae RabbitMQ**: el login sigue funcionando y los eventos de ese momento no se publican. M1 reintenta conectarse cada 10 segundos.
- **Si se cae otro módulo (por ejemplo M8)**: a M1 no le afecta. Los mensajes quedan guardados en la cola de RabbitMQ hasta que el módulo vuelva.

## Arquitectura en capas

Cada capa solo llama a la de abajo:

```text
src/
├── routes/          → Presentación: define los endpoints
├── middleware/      → Controles previos: JWT y rate limit del login
├── controllers/     → Recibe el request y arma la respuesta HTTP
├── services/        → Lógica de negocio: validar el login, contar intentos
├── repositories/    → Acceso a datos: solo acá se consulta la base
├── messaging/       → Publicación de eventos en RabbitMQ
└── config/          → Conexiones: base de datos, Redis y RabbitMQ
```

Archivos de RF-1.2:

| Capa | Archivo |
|---|---|
| Rutas | `src/routes/auth.routes.ts` |
| Middleware | `src/middleware/login-rate-limit.middleware.ts` |
| Controller | `src/controllers/auth.controller.ts` |
| Servicios | `src/services/auth.service.ts`, `src/services/login-attempts.service.ts` |
| Repositorio | `src/repositories/user.repository.ts` |
| Mensajería | `src/messaging/auth.publisher.ts` |
| Configuración | `src/config/redis.ts`, `src/config/rabbitmq.ts` |

## Tecnologías

- Node.js + TypeScript + Express.
- Redis 7 con la librería `ioredis`.
- RabbitMQ 3 con la librería `amqplib`.
- Vitest + Supertest para las pruebas, con `ioredis-mock` y un RabbitMQ simulado.

## Cómo levantarlo

Con Docker se levantan la API, Redis y RabbitMQ (uno de cada uno, solo para M1):

```bash
docker compose up -d --build
```

- API: `http://localhost:3001`
- Panel de RabbitMQ: `http://localhost:15672` (usuario `guest`, contraseña `guest`)

Para correr la API en local sin Docker, levantar solo los backing services:

```bash
docker compose up -d redis rabbitmq
npm start
```

## Variables de entorno

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Conexión a Redis |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | Conexión a RabbitMQ |
| `LOGIN_MAX_INTENTOS` | `5` | Intentos fallidos antes del bloqueo |
| `LOGIN_VENTANA_SEGUNDOS` | `60` | Duración de la ventana de intentos |
| `TRUST_PROXY` | `false` | Poner en `true` solo si hay un proxy que envía `X-Forwarded-For` |

## Pruebas

```bash
npm test
```

- `tests/integration/login-rate-limit.integration.test.ts`: límite de intentos y respuesta 429.
- `tests/integration/auth-events.integration.test.ts`: publicación de eventos en RabbitMQ.
