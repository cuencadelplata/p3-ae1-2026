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

1. Copiar las variables de ejemplo y completar `JWT_SECRET` (es la unica obligatoria):

   ```sh
   cp .env.example .env
   ```

2. Levantar todos los modulos:

   ```sh
   docker compose up -d --build
   ```

3. Comprobar que todos respondan:

   ```sh
   node tests-integracion/salud.mjs
   ```

## Test integral

[`tests-integracion/flujo-completo.e2e.mjs`](tests-integracion/flujo-completo.e2e.mjs) recorre un viaje completo con los servicios reales de los 9 modulos: registro, ubicacion del conductor, pedido, asignacion, inicio con QR, finalizacion, pago y comprobante.

```sh
node --env-file=.env --test tests-integracion/flujo-completo.e2e.mjs
```

Requisitos, opciones (pago con tarjeta, simulador de M7) y pasos pendientes en [`tests-integracion/README.md`](tests-integracion/README.md).
