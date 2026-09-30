# ADR-004: Persistencia de comprobantes en PostgreSQL (AE2)

* **Estado:** Aceptado
* **Fecha:** 2026-09-30
* **Autor:** Juan Gualtieri (evolución individual AE2)
* **Requerimientos:** RF-8.3, RNF-04, RNF-08, RNF-09, RNF-10, RNF-23
* **Reemplaza parcialmente a:** [ADR-001](ADR-001-m8-comprobantes-ae1.md), puntos 3 y 4 (sistema de archivos y candado en memoria)

---

## Contexto

En AE1 cada comprobante se guardaba como dos archivos en un volumen: un JSON con los
metadatos y el PDF, publicado además como archivo estático en `/files/receipts/<tripId>.pdf`.
La unicidad por viaje la garantizaba un candado en memoria (`withLock(tripId)`) sumado a
la creación exclusiva del archivo.

Ese diseño tiene tres límites para AE2:

1. **No escala a varias réplicas.** El candado vive en la memoria de un proceso: dos
   réplicas tienen dos candados y pueden emitir dos comprobantes para el mismo viaje.
2. **No es atómico.** Metadatos y PDF son dos escrituras separadas: un corte entre
   ambas deja un comprobante sin PDF o un PDF huérfano.
3. **Expone datos.** El nombre del archivo deriva del `tripId`, por lo que la URL es
   predecible.

## Decisión 1: PostgreSQL con esquema y rol propios

Los datos del servicio viven en el esquema `receipts` de la base del módulo, y el
servicio se conecta con el rol `m8_receipts`, que es dueño de ese esquema y no tiene
permisos sobre ningún otro (`infra/postgres/init/01-receipts.sh`).

| Alternativa | Por qué no |
| --- | --- |
| Una base PostgreSQL por servicio | Aísla igual, pero multiplica contenedores y configuración para un módulo con cuatro servicios. |
| Esquema compartido con los demás servicios del módulo | Cualquier servicio podría leer o modificar las tablas de otro: viola la propiedad de datos (RNF-04). |
| **Esquema propio + rol con permisos solo sobre él** | Aislamiento verificable (otro rol recibe `permission denied for schema receipts`) con una sola instancia. |

**Propiedad de datos.** El servicio administra el comprobante, su PDF, el historial de
reenvíos y sus bandejas de entrada y salida. Los datos de cliente, conductor y
recorrido **no son suyos**: los recibe en el evento y los guarda como una *foto
inmutable* (`jsonb`) del momento de la emisión, porque un comprobante no debe cambiar
si después cambia, por ejemplo, el nombre del cliente. No consulta tablas de otros
módulos: quien necesita el PDF lo pide por contrato (enlace temporal).

## Decisión 2: el PDF se guarda en la base (`bytea`), no en almacenamiento de objetos

El Sprint 0 del grupo planteaba migrar a "base relacional y almacenamiento de objetos".
Al implementarlo se compararon tres opciones:

| Criterio | Volumen con nombre opaco | Almacenamiento de objetos (MinIO/S3) | **PostgreSQL (`bytea`)** |
| --- | --- | --- | --- |
| Atomicidad comprobante + PDF | No: dos escrituras en sistemas distintos | No: dos escrituras en sistemas distintos | **Sí: una sola transacción** |
| PDF o comprobante huérfanos ante un corte | Posibles; requiere limpieza | Posibles; requiere limpieza | **Imposibles** |
| Dependencias nuevas | Ninguna | Un servicio más (MinIO) y su cliente | **Ninguna (ya se usa PostgreSQL)** |
| Varias réplicas | Requiere volumen compartido | Sí | **Sí** |
| Escala para archivos grandes o muchos millones | Media | **Alta** | Media |
| Tamaño real de un comprobante | — | — | ~3 KB |

Se eligió **PostgreSQL**: con comprobantes de unos pocos KB, el costo de `bytea` es
despreciable y a cambio se obtiene la garantía que el problema pide: **nunca existe un
comprobante sin su PDF ni un PDF sin su comprobante**. El almacenamiento de objetos
aporta escala que este volumen de datos no necesita y agrega una segunda escritura no
transaccional.

El PDF se guarda en `receipt_documents` con una clave `pdf_key` (UUID) que no deriva
del `tripId`. La publicación estática `/files/receipts` se eliminó: el PDF solo sale
por la API.

**Revisión prevista:** si en AE4 los documentos crecen en tamaño o cantidad, migrar el
contenido a almacenamiento de objetos manteniendo `pdf_key` como referencia. El resto
del modelo no cambia.

## Decisión 3: la unicidad la garantiza la base

`CONSTRAINT receipts_trip_id_key UNIQUE (trip_id)` es el árbitro de la concurrencia. Ante
dos emisiones simultáneas, una inserción gana y la otra recibe el error `23505`; el
servicio lo traduce a `ReceiptAlreadyExistsError`, relee el comprobante ganador y
responde de forma idempotente (`200 OK` o `created: false`).

| Alternativa | Por qué no |
| --- | --- |
| Candado en memoria (AE1) | No protege entre réplicas. Se eliminó. |
| Candado distribuido en Redis | Agrega una dependencia crítica a la emisión y exige manejar el vencimiento del candado si el proceso cae con él tomado. |
| Bloqueo consultivo de PostgreSQL por `tripId` | Funciona, pero protege solo al código que se acuerde de tomarlo; la restricción protege cualquier escritura. |
| **Restricción `UNIQUE`** | La garantía está en el dato, no en el código; funciona con cualquier cantidad de réplicas. |

La misma transacción incluye el PDF y el evento `receipt.issued` de la bandeja de
salida: el pedido que pierde la carrera revierte todo y no deja ni PDF huérfano ni un
segundo evento.

## Modelo resultante

| Tabla | Contenido | Clave de unicidad |
| --- | --- | --- |
| `receipts.receipts` | Comprobante y foto de los datos recibidos | `receipt_id`; `trip_id` único |
| `receipts.receipt_documents` | PDF (`bytea`) | `pdf_key`; `receipt_id` único |
| `receipts.receipt_deliveries` | Historial de reenvíos, solo inserción | identidad |
| `receipts.processed_messages` | Bandeja de entrada del consumidor | `message_id` |
| `receipts.outbox_events` | Bandeja de salida de eventos | `message_id` |

Las migraciones son idempotentes y se ejecutan al arrancar bajo un bloqueo consultivo,
para que dos réplicas que arrancan a la vez no choquen al crear las tablas.

## Consecuencias

* **Positivas:** consistencia entre comprobante, PDF y evento; unicidad por viaje con
  varias réplicas; aislamiento de datos verificable; el PDF deja de tener una URL predecible.
* **Negativas:** la base crece con el contenido de los PDF (unos 3 KB cada uno); el
  servicio depende de PostgreSQL para emitir y consultar (dependencia crítica en
  `/health/ready`).

## Evidencia

* `tests/unit/receipt.repository.test.ts`: persistencia, clave opaca y ausencia de PDF huérfano.
* `tests/integration/concurrencia.test.ts`: la carrera sin `UNIQUE` (8 comprobantes) frente a con `UNIQUE` (1), y dos réplicas reales.
* [Reporte de concurrencia AE2](../pruebas/concurrencia-idempotencia-ae2.md).
