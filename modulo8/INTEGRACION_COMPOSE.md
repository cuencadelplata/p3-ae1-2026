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
`M1_JWT_SECRET` y `M2_INTERNAL_API_KEY` deben coincidir con los contratos privados
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

El Compose se puede leer y los otros servicios se pueden iniciar sin configurar
las variables privadas de M8. Para iniciar `m8-app` y `m8-postgres`, sí hay que
completarlas: la aplicación valida las credenciales y PostgreSQL exige su
contraseña. Un `up` de todo el stack requiere la configuración de todos los
módulos incluidos.

```powershell
docker compose --env-file modulo8/.env.integracion config --quiet
docker compose --env-file modulo8/.env.integracion up -d --build --wait m8-app m6-viajes m6-sim-m3
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

El escenario crea un viaje de prueba, asigna conductor, registra arribo en M6,
obtiene el QR de M8 real y lo valida al iniciar el viaje. Comprueba el estado
`EN_CURSO` en M6 y un 409 ante otro consumo del mismo QR en M8. Inserta un viaje
de prueba y registros relacionados; no borra datos ni usa los scripts de carga
del Compose aislado. El conductor de esta prueba lo habilita `m6-sim-m3`, el
simulador M3 previsto por el Compose común de M6.

## Comprobante PDF (RF-8.3) con el viaje real

Al finalizar un viaje, M6 publica `TripCompleted` en `mobility.events`.
M8 lo recibe en la cola `m8.receipts.trip-completed` y arma el comprobante con
los datos de cada dueño: recorrido, horarios, distancia y total de M6; vehículo
y patente de M3; estado e importe del pago de M7. Antes de generar el PDF lo
autoriza con `m8-fiscal-sandbox`, el autorizador fiscal simulado que se levanta
junto con `m8-app`. El contrato está en la sección 5.6 del
[catálogo de eventos](contracts/events/catalogo-eventos-v1.md).

El cliente y el conductor del viaje consultan el comprobante con su token de
M1. Como M1 no comparte nombres con otros servicios, el PDF muestra el número de
usuario de cada uno.

Regla de pago (acuerdo del grupo M8): con tarjeta se emite cuando M7 la
autoriza; efectivo y transferencia se cobran fuera de la pasarela, M7 los deja
pendientes y el comprobante se emite con el pago pendiente. Un pago rechazado no
genera comprobante.

### M7 real o simulador de su contrato

El M7 real necesita su configuración privada (`modulo7/.env`: Supabase, Mercado
Pago y `M7_API_KEY`). Si no está disponible, M8 trae un simulador del mismo
contrato (tarifa con la fórmula de M7, registro, consulta, autorización y
rechazo del pago, `x-api-key`). Para usarlo, agregar a `.env.integracion`:

```
M6_M7_URL=http://m8-m7-sandbox:4020
M8_M7_PAYMENTS_URL=http://m8-m7-sandbox:4020
```

Con el M7 real se quitan esas dos líneas y se levanta `m7-api` en lugar del perfil.

### Prueba de punta a punta

Registra usuarios en M1, conductor y vehículo en M3, hace el viaje completo en
M6 y espera el comprobante en M8:

```powershell
docker compose --env-file modulo8/.env.integracion --profile m7-sandbox up -d --build --wait m8-app m8-m7-sandbox m6-viajes m4-api m3-conductor-api m3-vehiculos m1-identidad-acceso
cd modulo8
node tests/e2e/shared-compose-receipt.mjs
$env:RECEIPT_E2E_METODO_PAGO = 'efectivo'; node tests/e2e/shared-compose-receipt.mjs
```

La prueba también recorre los avisos del viaje (RF-8.1 → RF-8.6 → RF-8.7): el
cliente crea su perfil en M2 con canal push y registra un dispositivo en M8, y
la llegada del conductor, el inicio y la finalización quedan entregados por
push. Además reenvía el comprobante (RF-8.4).

`RECEIPT_E2E_METODO_PAGO` elige el medio de pago (por defecto `tarjeta`).

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

La configuración usa nombres de servicio para M1, M2 y M7. El Compose de M8
integrado no agrega copias simuladas de esos módulos. Si alguno todavía no está
levantado, las operaciones que lo consultan pueden responder indisponibilidad.
Configurar `M8_M1_IDENTITY_URL`, `M8_M2_API_URL`, `M8_M7_PAYMENTS_URL` y
`M8_FISCAL_API_URL` según los servicios acordados. Esto no impide probar QR,
que depende de Redis y de la clave interna compartida.

El Compose aislado `modulo8/compose.yaml` sigue siendo el entorno de los smokes,
escenarios de estrés y Grafana locales. No levantarlo simultáneamente con la
infraestructura común en los mismos puertos. Los JSON de `tests/stress/results/`
son evidencia local ignorada por Git y se pueden borrar tras conservar los
informes necesarios. Los scripts de `infra/postgres/init/` son código de
despliegue y deben mantenerse versionados con saltos de línea LF.
