# AE2 - Matilda Azcona

## Escenario
Calcular la estimación de tarifa de un viaje, registrar el método de pago, procesar la autorización/captura del cobro al completar el viaje, y calcular el cargo por cancelación y registrar ante el posterior cobro.

## Versión de AE1 utilizada como punto de partida
- Repositorio: https://github.com/cuencadelplata/p3-ae1-2026
- Branch base de AE1: M7--Tarifas,-Pagos-y-Liquidaciones
- Branch individual de AE2: ae2/azcona

## Módulo seleccionado
M7 - Tarifas, Pagos y Liquidaciones

## Estado heredado de AE1

**RF-7.2 - Método de pago:** Registrar o seleccionar un medio de pago permitido por el escenario.
Comunicación: API síncrona.
El cliente queda esperando que el método de pago elegido se confirme, para poder continuar con la petición del viaje. Necesita la respuesta al momento para poder avanzar. Esta información sale de M6, cuando el cliente solicita el viaje y elige el tipo de pago.
- POST /metodo-pago
- GET /metodo-pago/:viajeId

**RF-7.3 - Autorización/captura:** Simular o integrar autorización y captura de pago al completar el viaje.
Comunicación: Bus asíncrono.
Cuando M6 termina el viaje, manda un mensaje a M7 avisando que terminó el viaje, y cuando M7 está disponible procesa el cobro. No hay un cliente esperando respuesta; un endpoint no sería adecuado en este caso: con el bus uno avisa y el otro reacciona cuando le toca.
- Estado en AE1: implementado como endpoints HTTP (POST /metodo-pago/:viajeId/autorizar y POST /metodo-pago/:viajeId/rechazar), no como consumidor de bus.

## Requerimientos funcionales que evolucionaré en AE2
- RF-7.3: pasar de endpoint HTTP a consumidor de RabbitMQ, suscripto al evento TripCompleted de M6.
- RF-7.2: agregar idempotencia y documentar el contrato en OpenAPI.

## Requerimientos no funcionales relacionados
- RNF-06: Redis para [completar]
- RNF-07: RabbitMQ para al menos dos flujos asíncronos
- RNF-08: Idempotencia en operaciones críticas (registro de método de pago y cobro)

## Dependencias con otros componentes (M6 - Viajes)
- RF-7.2 <- M6 RF-6.1 (POST /api/viajes): M6 devuelve el identificador del viaje como `id` y M7 lo recibe como `viajeId`; `clienteId` coincide en ambos. El cliente mapea id a viajeId.
- RF-7.3 <- M6 RF-6.4 (finalización del viaje): hoy M6 llama por HTTP síncrono a POST /api/pagos/captura dentro de la finalización, no publica el evento TripCompleted y no tiene RabbitMQ como dependencia. Esto contradice el diseño asíncrono de RF-7.3 y está pendiente de acordar con el equipo de M6.

