# Tests end-to-end de la AE4

Pegan contra M1, Redis y RabbitMQ **reales**, sin mocks. Usan solo Node (`node --test` y `fetch`), sin dependencias extra.

| Archivo | Comando | Qué prueba | Duración |
| --- | --- | --- | --- |
| `rf-1.2-ae4.e2e.test.mjs` | `npm run test:e2e:ae4` | Login, `/auth/me`, rate limit con Redis real, eventos que llegan a RabbitMQ y métricas | ~1 s |
| `resiliencia-ae4.e2e.test.mjs` | `npm run test:e2e:resiliencia` | Apaga y prende Redis y RabbitMQ: M1 no se cae y se reconecta solo | ~1 a 2 min |
| `helpers-ae4.mjs` | — | Funciones compartidas | — |

## Antes de correrlos

1. Redis y RabbitMQ levantados con el compose de M1 (contenedores `m1-redis` y `m1-rabbitmq`).
2. M1 levantado, de cualquiera de estas dos formas:
   - `docker compose up -d --build` (M1 también en Docker), o
   - `npm run dev` (M1 en la PC, usando Redis y RabbitMQ de Docker).
3. Correr los comandos desde la carpeta `modulo-1-identidad-acceso`.

Si la IP quedó bloqueada por un test anterior (por ejemplo, el de estrés), los tests esperan solos a que se libere (hasta 60 s).

## `npm run test:e2e:ae4`: RF-1.2 de punta a punta

1. Login correcto: 200 con token.
2. `GET /auth/me`: devuelve los datos del dueño del token, sin la contraseña.
3. El evento `auth.login_exitoso` llega a RabbitMQ. El test crea una cola de prueba enlazada al exchange `m1.eventos` y lee el mensaje con la API de administración de RabbitMQ (puerto 15672).
4. 5 fallos y después 429 con `Retry-After`. Con la IP bloqueada, ni la contraseña correcta pasa. Las métricas suben exactamente lo que pasó.
5. El evento `auth.ip_bloqueada` llega a RabbitMQ con `intentos: 5`.
6. `/metrics` muestra Redis y RabbitMQ conectados.

## `npm run test:e2e:resiliencia`: apagar y prender

1. `docker stop m1-redis`: `/health` responde, el login da 200 (fail-open) y la métrica de Redis pasa a 0.
2. `docker start m1-redis`: M1 se reconecta solo, sin reiniciarse; la métrica vuelve a 1.
3. `docker stop m1-rabbitmq`: el login sigue dando 200 y la métrica de RabbitMQ pasa a 0.
4. `docker start m1-rabbitmq`: M1 se reconecta solo al publicar el siguiente evento (reintenta cada 10 s); la métrica vuelve a 1.

Al final deja Redis y RabbitMQ prendidos, aunque algún test falle.
Con el tablero de Grafana Cloud abierto, se ve cada servicio pasar a **Caído** y volver a **Arriba**.

Si los contenedores tienen otros nombres, se puede cambiar el comando con las variables `E2E_STOP_REDIS`, `E2E_START_REDIS`, `E2E_STOP_RABBITMQ` y `E2E_START_RABBITMQ`.
