# Concurrencia e idempotencia de la emisión (AE2)

**Requerimientos:** RF-8.3, RNF-08 (idempotencia), RNF-09 (consistencia y concurrencia)
**Reemplaza para AE2 a:** [reporte-pruebas-concurrencia.md](reporte-pruebas-concurrencia.md) (AE1, se conserva como evidencia)

## 1. El problema: consultar y después insertar

La emisión de un comprobante sigue tres pasos:

1. Buscar si el viaje ya tiene comprobante (`findByTripId`).
2. Si no lo tiene, generar el PDF (unos 100 ms).
3. Guardar el comprobante (`create`).

Entre el paso 1 y el 3 hay una ventana. Si dos pedidos del mismo viaje llegan a
la vez, los dos consultan antes de que cualquiera guarde, los dos ven que no
existe y los dos emiten:

```
Pedido A                          Pedido B
findByTripId(t-1) -> no existe
                                  findByTripId(t-1) -> no existe
genera PDF ...                    genera PDF ...
create(t-1)  -> CMP-A
                                  create(t-1)  -> CMP-B   <- segundo comprobante
```

En AE2 esa situación es esperable y no un caso raro:

- RabbitMQ entrega **al menos una vez**: tras una reconexión, el mismo
  `payment.confirmed` puede llegar dos veces.
- M7 puede publicar dos mensajes distintos para el mismo viaje.
- El servicio puede correr en **varias réplicas** que consumen la misma cola.

### Por qué la solución de AE1 ya no alcanza

En AE1 los pedidos se serializaban con un candado en memoria por `tripId`
(`withLock`). Ese candado vive en la memoria de un proceso: con dos réplicas,
cada una tiene el suyo y los pedidos que llegan a réplicas distintas no se
esperan entre sí. El candado solo protegía el caso de una instancia.

## 2. La solución

La unicidad la garantiza PostgreSQL, que es lo único que comparten todas las
réplicas.

| Capa | Mecanismo | Qué cubre |
| --- | --- | --- |
| Base de datos | `CONSTRAINT receipts_trip_id_key UNIQUE (trip_id)` | Pedidos simultáneos, en una o varias réplicas. El segundo `INSERT` falla con el código `23505`; el servicio lo traduce a `ReceiptAlreadyExistsError`, relee el comprobante ganador y lo devuelve (`200 OK` o `created: false`). |
| Transacción | Comprobante, PDF y evento `receipt.issued` en un solo `COMMIT` | El pedido que pierde revierte todo: no deja un PDF huérfano ni un segundo evento. |
| Mensajería | Bandeja de entrada `processed_messages` por `messageId` | Reentregas del mismo mensaje: se descartan sin volver a procesarlas. |
| Publicación | Bandeja de salida con `FOR UPDATE SKIP LOCKED` | Con varias réplicas, cada `receipt.issued` lo publica una sola. |

El candado en memoria se eliminó: con la restricción no aporta nada y daba una
falsa sensación de seguridad.

## 3. Evidencia automatizada

`tests/integration/concurrencia.test.ts` (se ejecuta con `pnpm run test`):

| Prueba | Resultado esperado |
| --- | --- |
| Sin `UNIQUE`: 8 pedidos simultáneos con consultar-y-después-insertar sobre una tabla sin la restricción | **8 comprobantes** para el mismo viaje: el problema reproducido. |
| Con `UNIQUE`: la misma carrera sobre la tabla real | 1 comprobante, 1 evento, 7 `ReceiptAlreadyExistsError`. |
| Dos réplicas, mensajes duplicados: 7 mensajes del mismo viaje (uno repetido 3 veces y otros dos mensajes repetidos 2 veces) repartidos entre dos procesos | 1 comprobante, 1 evento, las dos réplicas procesaron mensajes. |
| Dos réplicas, pedidos HTTP: 8 `POST` simultáneos alternados entre las dos réplicas | 1 respuesta `201`, 7 respuestas `200`, un único `receiptId`. |

Para que la carrera sea reproducible, las pruebas usan una barrera: todos los
pedidos terminan la consulta antes de que cualquiera inserte. Así la ventana
que en el servicio abre la generación del PDF se abre siempre, no por azar.

Cada réplica es un proceso Node aparte (`tests/helpers/replica.ts`), con su
propio pool de PostgreSQL, su propia conexión a RabbitMQ y su propio servidor
HTTP. No comparten memoria, igual que dos contenedores.

## 4. Demostración con dos contenedores

Desde `modulo-8`:

```bash
docker compose --profile replicas up -d --build   # receipts (3008) y receipts-replica (3018)
cd services/receipts
pnpm run prueba:replicas                          # 8 POST simultáneos repartidos entre las dos
pnpm run demo:pago                                # payment.confirmed + reentrega con las dos consumiendo la cola
cd ../..
docker compose --profile replicas logs receipts receipts-replica
docker compose --profile replicas down
```

Resultado esperado de `prueba:replicas`: un `201 Created`, siete `200 OK`,
un único `receiptId`. En los logs de `demo:pago` suele verse que una réplica
emite el comprobante y la otra descarta la reentrega como repetida.
