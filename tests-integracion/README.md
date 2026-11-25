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
| 5b | M9 → M1 → M5 | El scheduler obtiene autorización delegada, crea la solicitud y M5 emite la oferta |
| 6 | M5 (+ M4) | Pedido del pasajero, candidatos, oferta y aceptación del conductor |
| 7 | M6 | M5 creó y asignó el viaje |
| 8 | M6 + M8 + M4 | Arribo con QR de M8, inicio validado, el QR no se reutiliza, conductor ocupado en M4 |
| 9 | M6 + M4 + M7 | Finalización con métricas de M4, tarifa y pago de M7, conductor liberado en M4 |
| 10 | M8 (+ M3) | Comprobante emitido desde TripCompleted, con la patente de M3 y el total del viaje |
| 11 | M6 + M2 | Historial de transiciones completo y viaje visible en el historial de M2 |
| 12 | RabbitMQ | Ninguna cola de mensajes muertos creció durante la prueba |

## Cómo correrlo

1. Seguí el [arranque del stack completo](../README.md#levantar-el-stack-completo)
   para preparar la red, el `.env` raíz y `modulo7/.env`. Usá
   `ROUTE_RESOLVER_MODE=m4` para probar las rutas reales.
2. Corré el test desde la raíz:

   ```sh
   node --env-file=.env --test tests-integracion/flujo-completo.e2e.mjs
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

## Activación de reservas (M9 → M1 → M5)

M9 activa la reserva desde su scheduler. Configurá `M9_DISPATCH_AUTH_URL=http://m1-identidad-acceso:3001/auth/token-delegado` y la credencial privada `M9_DISPATCH_AUTH_TOKEN` que comparten M1 y M9. M9 usa el token delegado para crear la solicitud y pedirle a M5 que envíe la oferta.

Para probar **reserva programada → oferta → viaje → comprobante**, levantá M5 y M9 con las imágenes construidas desde este código y ejecutá desde la raíz en PowerShell.

```powershell
$env:E2E_RESERVA_PROGRAMADA = '1'
$env:METODO_PAGO = 'tarjeta'
node --env-file=.\modulo8\.env.integracion --test .\tests-integracion\flujo-completo.e2e.mjs
Remove-Item Env:E2E_RESERVA_PROGRAMADA, Env:METODO_PAGO
```

La opción `tarjeta` requiere las credenciales de Mercado Pago TEST de M7. Sin `E2E_RESERVA_PROGRAMADA`, la suite conserva el recorrido de despacho inmediato.

Las cuentas de esta suite carecen de suscripción Web Push. M8 registra el resultado de entrega sin dispositivo y confirma el mensaje sin enviarlo a la DLQ. Para comprobar la recepción en el navegador hace falta una suscripción Web Push activa.
