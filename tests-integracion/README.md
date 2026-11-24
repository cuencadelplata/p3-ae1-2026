# Test integral del stack común

`flujo-completo.e2e.mjs` recorre un viaje completo con los servicios reales de los 9 módulos:

| Paso | Módulos | Qué comprueba |
| --- | --- | --- |
| 0 | Todos | Cada módulo responde su health |
| 1 | M1 | Registro e inicio de sesión de pasajero y conductor |
| 2 | M2 | Perfil del pasajero asociado a su usuario de M1 |
| 3 | M3 | Conductor habilitado con vehículo activo |
| 4 | M4 | Ubicación del conductor publicada y disponible |
| 5 | M9 (+ M1, M7) | Reserva programada con la identidad de M1 y la tarifa estimada por M7 |
| 5b | M9 → M5 | Pendiente (ver abajo) |
| 6 | M5 (+ M4) | Pedido del pasajero, candidatos, oferta y aceptación del conductor |
| 7 | M6 | M5 creó y asignó el viaje |
| 8 | M6 + M8 + M4 | Arribo con QR de M8, inicio validado, el QR no se reutiliza, conductor ocupado en M4 |
| 9 | M6 + M4 + M7 | Finalización con métricas de M4, tarifa y pago de M7, conductor liberado en M4 |
| 10 | M8 (+ M3) | Comprobante emitido desde TripCompleted, con la patente de M3 y el total del viaje |
| 11 | M6 + M2 | Historial de transiciones completo y viaje visible en el historial de M2 |
| 12 | RabbitMQ | Ninguna cola de mensajes muertos creció durante la prueba |

## Cómo correrlo

1. Crear la red compartida (los compose de M6 y M7 la declaran externa):

   ```sh
   docker network create reservas-network
   ```

2. En el `.env` de la raíz, además de las claves de cada módulo, agregar `ROUTE_RESOLVER_MODE=stub` para que M9 resuelva rutas.
3. Levantar el stack desde la raíz: `docker compose up -d --build`.
4. Correr el test desde la raíz:

   ```sh
   node --test tests-integracion/flujo-completo.e2e.mjs
   ```

No necesita instalar dependencias. Cada corrida crea usuarios nuevos, así que se puede repetir.

Opciones: `METODO_PAGO=tarjeta` paga con una tarjeta de prueba de Mercado Pago (usa `MP_ACCESS_TOKEN` de `modulo7/.env`); cada URL de módulo se puede cambiar con `M1_URL`, `M2_URL`, …, `M9_URL`.

## M7 real o simulador

El M7 real necesita `modulo7/.env` con `DATABASE_URL`, `M7_API_KEY`, `MP_ACCESS_TOKEN` y las claves de Supabase. Si no está disponible, se puede usar el simulador del contrato de M7 que trae M8:

```sh
docker build -t m7-sandbox:local modulo8/infra/m7-payments-sandbox
docker run -d --name m8-m7-sandbox --network reservas-network -p 127.0.0.1:4020:4020 -e M7_API_KEY=<la misma M7_API_KEY del .env> -e UNREGISTERED_TRIPS=not_found m7-sandbox:local
```

y en el `.env` de la raíz apuntar `M6_M7_URL`, `M8_M7_PAYMENTS_URL`, `M7_URL` y `M7_BASE_URL` a `http://m8-m7-sandbox:4020`. Al correr el test, pasar `M7_URL=http://localhost:4020`. `UNREGISTERED_TRIPS=not_found` hace que responda como M7 cuando un viaje no tiene pago registrado.

## Pendiente: activación de reservas (M9 → M5)

M9 activa la reserva desde su scheduler, fuera de una petición del pasajero, y para pedir el viaje a M5 necesita un token delegado de M1 (`M9_DISPATCH_AUTH_URL`). M1 todavía no publica ese servicio, así que la activación responde `DELEGACION_NO_CONFIGURADA`. El paso queda marcado como pendiente (`todo`) hasta que exista.
