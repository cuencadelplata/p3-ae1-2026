# M8 en el Compose común

El `docker-compose.yml` de la raíz incluye `modulo8/compose.integracion.yaml`.
M8 usa Redis y RabbitMQ del stack común en `reservas-network`. Su PostgreSQL
es `m8-postgres`, con volumen propio y sin publicar otro puerto 5432.

## Configuración privada

Desde la raíz del repositorio:

```powershell
Copy-Item modulo8/integracion.env.example modulo8/.env.integracion
```

Completar los marcadores del archivo local. No subirlo a Git.
`QR_INTERNAL_API_KEY` debe tener al menos 16 caracteres: el Compose de M6 y el
de M8 leen esa misma variable. Las credenciales `RABBITMQ_USER` y
`RABBITMQ_PASSWORD`, si se cambian, deben coincidir con el broker compartido.
Las contraseñas `M8_*` son exclusivas de la base de M8 y no cambian las de M9.
`M1_JWT_SECRET` es la clave común de M1, M3, M5 y M8. Como alternativa
se admite `JWT_SECRET`; si ambas existen, prevalece `M1_JWT_SECRET`.
`M2_INTERNAL_API_KEY` debe coincidir con el contrato privado
de esos módulos cuando se prueben sus funcionalidades.

Quien también tenga `modulo8/.env` (el del Compose aislado) debe dejar
`RABBITMQ_USER` y `RABBITMQ_PASSWORD` escritos en `.env.integracion`: Compose lee
el `.env` de la carpeta de cada archivo incluido para las variables que no
recibe, y el aislado usa `guest`, que el broker común rechaza
(`ACCESS_REFUSED` en los logs de `m8-app`).

Si el equipo ya tiene un `.env` en la raíz, agregar allí las variables de la
plantilla y omitir `--env-file` en los comandos siguientes. Todos deben levantar
el proyecto con el mismo archivo de configuración.

## Levantar M8 y probar QR con M6

Compose exige la clave JWT común (`M1_JWT_SECRET`) al leer los archivos de M1,
M3 y M5, incluso si se seleccionan servicios de otros módulos. Las contraseñas
de M8 no hace falta definirlas para leer o levantar el stack. La demo de M9
mantiene su configuración automática mediante `npm run integration:up`.

La red común es externa: se crea una sola vez con
`docker network create reservas-network` (el script de M6
`npm run docker:integration:up` también la crea si falta).

```powershell
docker network create reservas-network
docker compose --env-file modulo8/.env.integracion config --quiet
docker compose --env-file modulo8/.env.integracion up -d --build --wait m8-app m6-viajes m3-conductor-api m1-identidad-acceso
```

- API M8 desde el host: `http://localhost:18000`.
- API M8 desde M6: `http://m8-app:3000`.
- API M6 desde el host: `http://localhost:15000`.
- Generación QR: `POST /qr` con `x-api-key`.
- Validación QR: `POST /qr/validate` con `x-api-key` e `Idempotency-Key`.

No usar el `localhost` del host como URL interna entre contenedores.
M6 ya configura `M8_URL=http://m8-app:3000` y toma `M8_QR_API_KEY` de
`QR_INTERNAL_API_KEY`. M8 conserva sus rutas originales.

Con las dependencias Node de M8 instaladas:

```powershell
cd modulo8
node tests/e2e/shared-compose-qr.mjs
```

El escenario registra un cliente y un conductor en M1, habilita al conductor en
M3, crea el viaje, asigna conductor, registra el arribo en M6, obtiene el QR de
M8 y lo valida al iniciar el viaje. Comprueba el estado `EN_CURSO` en M6 y un
409 ante otro consumo del mismo QR en M8. Todos los módulos son reales; inserta
registros de prueba y no borra datos.

## Comprobante PDF (RF-8.3) con el viaje real

Al finalizar un viaje, M6 publica `TripCompleted` en `mobility.events`.
M8 lo recibe en la cola `m8.receipts.trip-completed` y arma el comprobante con
los datos de cada dueño: recorrido, horarios, distancia y total de M6; vehículo
y patente de M3; estado e importe del pago de M7. El comprobante no pasa por un
autorizador fiscal: es un documento académico y no constituye comprobante fiscal.
El contrato está en la sección 5.6 del
[catálogo de eventos](contracts/events/catalogo-eventos-v1.md).

El cliente y el conductor del viaje consultan el comprobante con su token de
M1. Como M1 no comparte nombres con otros servicios, el PDF muestra el número de
usuario de cada uno.

Regla de pago (acuerdo del grupo M8): con tarjeta se emite cuando M7 la
autoriza; efectivo y transferencia se cobran fuera de la pasarela, M7 los deja
pendientes y el comprobante se emite con el pago pendiente. Un pago rechazado no
genera comprobante.

### M7 real

M6 y M8 consultan al M7 real (`m7-api`) con la clave `M7_API_KEY` que acordó
M7. M7 lee su propia configuración de `modulo7/.env` (`M7_API_KEY`,
`MP_ACCESS_TOKEN`, `SUPABASE_URL` y `SUPABASE_KEY`), guarda los pagos en su
proyecto de Supabase y autoriza las tarjetas con Mercado Pago (credenciales de
prueba). Sin ese archivo, M7 no puede registrar pagos y el viaje no se finaliza.

Con tarjeta, la prueba de punta a punta hace el paso de la app del cliente:
tokeniza en Mercado Pago la tarjeta de prueba "APRO" con el `MP_ACCESS_TOKEN`
de `modulo7/.env` y M6 reenvía ese token a M7.

### Prueba de punta a punta

Registra usuarios en M1, conductor y vehículo en M3, hace el viaje completo en
M6 y espera el comprobante en M8:

```powershell
docker compose --env-file modulo8/.env.integracion up -d --build --wait m8-app m7-api m6-viajes m4-api m3-conductor-api m3-vehiculos m1-identidad-acceso m2-gateway
cd modulo8
node tests/e2e/shared-compose-receipt.mjs
$env:RECEIPT_E2E_METODO_PAGO = 'efectivo'; node tests/e2e/shared-compose-receipt.mjs
```

La prueba también recorre los avisos del viaje (RF-8.1 → RF-8.6 → RF-8.7) con
las preferencias del cliente en M2, y reenvía el comprobante (RF-8.4).

`RECEIPT_E2E_METODO_PAGO` elige el medio de pago (por defecto `tarjeta`).

## Notificaciones push reales en el navegador (RF-8.7)

M8 envía los avisos por Web Push, firmados con sus claves VAPID
(`M8_VAPID_PUBLIC_KEY` y `M8_VAPID_PRIVATE_KEY` en `.env.integracion`), al
servicio de push del navegador (FCM en Chrome y Edge, Mozilla Push en Firefox).

1. Abrir `http://localhost:18000/push` en Chrome, Edge o Firefox.
2. Iniciar sesión con un usuario de M1 y tocar **Activar en este navegador**.
3. **Enviar aviso de prueba** muestra una notificación del sistema.

Desde ahí, los avisos de los viajes de ese usuario (conductor asignado, llegada,
inicio, finalización, cancelación) llegan como notificaciones del navegador.
Un usuario sin navegador suscripto queda con la entrega `FAILED_NO_DEVICE_TOKEN`.

## Correo de recuperación de contraseña de M1

M1 (RF-1.4) publica `auth.recuperacion_solicitada` en su exchange `m1.eventos`
con el email, el nombre y el código. M8 lo recibe en la cola
`m8.delivery.password-recovery` y envía el correo por SMTP. Con Gmail:

1. En la cuenta de Google, activar la verificación en dos pasos y crear una
   contraseña de aplicación.
2. Completar `M8_SMTP_USER`, `M8_SMTP_PASSWORD` y `M8_MAIL_FROM` en
   `.env.integracion` y recrear `m8-app`.

Sin esa configuración los pedidos quedan esperando en la cola y se envían cuando
se configura. El correo no se guarda en M8: solo queda la constancia de la entrega.

## Soporte, entrega de avisos y observabilidad

- `/tickets` (RF-8.5) exige un Bearer de M1 en el stack común y aplica permisos:
  cualquier usuario crea tickets; listar y cambiar estados es del `OPERADOR`;
  ver un ticket o su historial, del `OPERADOR` o de quien lo creó.
- RF-8.7 consulta preferencias a M2 con circuit breaker: si M2 no responde,
  tras 3 fallas deja de consultarlo 30 s y falla al instante, sin frenar al
  resto de la app (`UV_THREADPOOL_SIZE=16` en `m8-app`).
- Métricas de `m8-app` a Grafana Cloud desde el stack común: perfil
  `observability` (`m8-alloy`), con `GRAFANA_CLOUD_*` en `.env.integracion`.
Para ver la cola y la DLQ: RabbitMQ → Queues → `m8.receipts.trip-completed*`.

## Alcance de los demás requerimientos

La configuración usa nombres de servicio para M1, M2, M3, M6 y M7. El Compose
de M8 integrado no agrega copias simuladas de esos módulos. Si alguno todavía no
está levantado, las operaciones que lo consultan pueden responder
indisponibilidad. Configurar `M8_M1_IDENTITY_URL`, `M8_M2_API_URL` y
`M8_M7_PAYMENTS_URL` solo si cambian los nombres de servicio. Esto no impide
probar QR, que depende de Redis y de la clave interna compartida.

Las contraseñas de la base de M8 tienen valores locales por defecto, así que
ningún otro módulo necesita configurar M8 para levantar el stack común.

El Compose aislado `modulo8/compose.yaml` sigue siendo el entorno de los smokes,
escenarios de estrés y Grafana locales. No levantarlo simultáneamente con la
infraestructura común en los mismos puertos. Los JSON de `tests/stress/results/`
son evidencia local ignorada por Git y se pueden borrar tras conservar los
informes necesarios. Los scripts de `infra/postgres/init/` son código de
despliegue y deben mantenerse versionados con saltos de línea LF.
