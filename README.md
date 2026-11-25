# Movilidad urbana - P3 AE1 2026

Sistema de viajes urbanos dividido en 9 modulos que se comunican por HTTP y RabbitMQ.
El `docker-compose.yml` de la raiz levanta el stack comun con todos los modulos en la red `reservas-network`.

## Modulos

| Modulo | Carpeta | Puerto local | Health |
| --- | --- | --- | --- |
| M1 Identidad y acceso | [`modulo-1-identidad-acceso`](modulo-1-identidad-acceso) | 10000 (UI 5173) | `/health` |
| M2 Perfil, historial y estado | [`m2`](m2) | 11000 (UI 11001) | `/health/live` |
| M3 Conductores y vehiculos | [`modulo-3`](modulo-3) | 5000 conductores, 8083 vehiculos (UI 4000) | `/health` |
| M4 Ubicacion y disponibilidad | [`modulo-4`](modulo-4) | 3004 (UI 8084) | `/health` |
| M5 Solicitud y despacho | [`modulo-5`](modulo-5) | 3005 | `/health` |
| M6 Viajes | [`modulo6`](modulo6) | 15000 (cancelacion 15001, fachada 15002) | `/health` |
| M7 Tarifas y pagos | [`modulo7`](modulo7) | 17000 | `/health` |
| M8 QR, comprobantes y notificaciones | [`modulo8`](modulo8) | 18000 | `/health/live` |
| M9 Reservas programadas | [`M9-ReservasProgramadas`](M9-ReservasProgramadas) | 3000 | `/health` |

Los detalles de cada modulo (endpoints, variables, pruebas) estan en el README de su carpeta.

## Levantar el stack completo

Instalá Git, Docker Desktop con Compose v2 y Node.js 22 o superior para
ejecutar las verificaciones. Desde un clon nuevo, abrí PowerShell en la raíz.

```powershell
git switch main
git pull --ff-only origin main
Copy-Item .env.example .env
Copy-Item .\modulo7\.env.example .\modulo7\.env
```

Si los archivos ya existen, editá los que tenés. Cada integrante puede generar
sus propias claves internas si levanta una instalación local independiente.

- **`.env` de la raíz.** Configurá un `JWT_SECRET` privado para la instalación,
  `QR_INTERNAL_API_KEY` para el inicio de viaje y `M7_API_KEY` para que M6 y M8
  consulten pagos. Para reservas automáticas, definí `M9_DISPATCH_AUTH_TOKEN`.
  Elegí claves distintas para cada integración. Para tarjeta en el frontend,
  agregá `MP_PUBLIC_KEY` del mismo entorno TEST que M7.
- **`modulo7/.env`.** El equipo de M7 debe proporcionar acceso a un entorno de
  pruebas ya preparado. Completá `DATABASE_URL`, `SUPABASE_URL`,
  `SUPABASE_KEY`, `MP_ACCESS_TOKEN` de Mercado Pago TEST y la misma
  `M7_API_KEY` usada en la raíz. Compose toma la configuración de este archivo
  para el servicio M7.
- **M8.** El Compose común toma las variables de la raíz. Los valores de
  PostgreSQL que trae Compose habilitan una instalación local nueva. Para
  Web Push, SMTP, consultas internas o Grafana, completá sus variables en el
  `.env` según [la plantilla de M8](modulo8/integracion.env.example). La bandeja
  interna de avisos funciona con la sesión de M1.

```powershell
docker compose config --quiet
docker network inspect reservas-network *> $null
if ($LASTEXITCODE -ne 0) { docker network create reservas-network }
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
node --env-file=.env tests-integracion/salud.mjs
```

La red se crea una sola vez por máquina. El Compose común la comparte entre
los módulos.

Abrí **http://localhost:5173**. La
[guía del frontend](modulo-1-identidad-acceso-ui/README.md#probar-con-dos-cuentas-desde-un-clon-limpio)
muestra cómo registrar cliente y conductor, habilitar el conductor en M3 y
probar una asignación con dos sesiones.

Si ya usás `modulo8/.env.integracion` como archivo común, pasá
`--env-file .\modulo8\.env.integracion` a Compose y
`--env-file=.\modulo8\.env.integracion` a Node. Las credenciales de pagos
siguen en `modulo7/.env`. Para compartir la instalación,
pasá las plantillas de Git y entregá el acceso al entorno de pruebas de M7
por separado. Evitá distribuir archivos que contengan credenciales personales.

## Test integral

[`tests-integracion/flujo-completo.e2e.mjs`](tests-integracion/flujo-completo.e2e.mjs) recorre un viaje completo con los servicios reales de los 9 modulos: registro, ubicacion del conductor, pedido, asignacion, inicio con QR, finalizacion, pago y comprobante.

```sh
node --env-file=.env --test tests-integracion/flujo-completo.e2e.mjs
```

Requisitos, opciones (pago con tarjeta, simulador de M7) y pasos pendientes en [`tests-integracion/README.md`](tests-integracion/README.md).
