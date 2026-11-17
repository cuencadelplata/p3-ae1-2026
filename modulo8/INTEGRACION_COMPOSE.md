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
