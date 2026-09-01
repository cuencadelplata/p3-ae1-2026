# Requerimientos de M9 – Reservas Programadas

## Objetivo

M9 debe administrar reservas de viajes futuros, conservarlas en Supabase y activarlas automáticamente cuando llegue su fecha programada. La entrega incluye API, interfaz de usuario, contenedores y pruebas locales end-to-end; no incluye despliegue del servicio en cloud.

## Actores y dependencias

- **Cliente u operador:** crea, consulta, modifica y cancela reservas desde la API o la UI.
- **M9:** propietario lógico de las reservas programadas.
- **M7 – Tarifas:** entrega una tarifa estimada durante la creación.
- **M5 – Solicitud y Despacho:** recibe una reserva cuando debe comenzar el viaje.
- **Supabase:** persistencia única y fuente de verdad del scheduler.

## Requerimientos funcionales

| ID | Requerimiento | Criterio de aceptación | Evidencia |
| --- | --- | --- | --- |
| RF-01 | Crear reservas | Debe aceptar cliente, origen, destino, vehículo y fecha futura; persiste `PROGRAMADA`. | `POST /reservas`, tests API y E2E. |
| RF-02 | Estimar tarifa | Al crear, consulta M7 y guarda tarifa y moneda válidas. | `HttpTarifaClient`, M7 stub, E2E. |
| RF-03 | Degradar ante fallo de M7 | Si M7 falla, la reserva se crea con tarifa nula. | Test unitario de `ReservaService`. |
| RF-04 | Consultar reservas | Debe listar por fecha y obtener una reserva por UUID. | `GET /reservas`, `GET /reservas/:id`. |
| RF-05 | Modificar reservas | Solo permite cambiar origen, destino, vehículo o fecha cuando está `PROGRAMADA`. | `PATCH /reservas/:id`, tests de conflicto. |
| RF-06 | Cancelar reservas | Debe realizar cancelación lógica solo desde `PROGRAMADA`. | `DELETE /reservas/:id`, estado `CANCELADA`. |
| RF-07 | Validar entradas | Rechaza UUID, vehículo, ubicaciones o fecha inválidos y campos controlados por backend. | Esquemas Zod y tests de errores. |
| RF-08 | Detectar vencimientos | Un scheduler consulta filas `PROGRAMADA` cuya fecha ya llegó. | `ReservasScheduler`, test E2E. |
| RF-09 | Reclamar atómicamente | Dos workers no pueden activar la misma reserva. | Update condicionado y test concurrente. |
| RF-10 | Activar en M5 | El ganador crea una solicitud M5, guarda su UUID y pasa a `ACTIVADA`. | M5 stub, servicio de activación y E2E. |
| RF-11 | Registrar fallo de M5 | Si M5 falla después del reclamo, la reserva pasa a `FALLIDA`. | Test del scheduler. |
| RF-12 | Exponer UI funcional | La UI debe crear, listar, filtrar, editar, cancelar y actualizar reservas. | `/`, recursos de `public/`, QA en navegador. |
| RF-13 | Documentar la API | Debe existir OpenAPI portable y Swagger UI. | `openapi/openapi.yaml`, `/docs`. |
| RF-14 | Informar salud | Debe exponer el estado básico del servicio. | `GET /health`. |

## Requerimientos no funcionales

| ID | Requerimiento | Criterio de aceptación |
| --- | --- | --- |
| RNF-01 | Tipado | TypeScript estricto y tipos de base generados desde el esquema real. |
| RNF-02 | Persistencia | El scheduler no usa una cola de reservas en memoria; siempre consulta Supabase. |
| RNF-03 | Seguridad | La secret key queda solo en backend; RLS permanece habilitado y no se exponen detalles internos. |
| RNF-04 | Tiempo | La API acepta ISO 8601 con offset y persiste `timestamptz` en UTC. |
| RNF-05 | Concurrencia | La transición `PROGRAMADA -> ACTIVANDO` debe ser atómica. |
| RNF-06 | Contenedores | M9, M5 stub y M7 stub deben ejecutarse en una red Docker Compose local. |
| RNF-07 | Portabilidad | Debe existir una imagen publicable en Docker Hub. |
| RNF-08 | Verificación | Debe haber pruebas unitarias, integración y E2E local contra contenedores. |
| RNF-09 | Usabilidad | La UI debe ser responsive, navegable con teclado y presentar estados de carga, éxito, error y vacío. |
| RNF-10 | Operación | El proceso debe detener servidor y scheduler ante `SIGINT` o `SIGTERM`. |

## Reglas de negocio

1. El origen y el destino deben ser diferentes.
2. La fecha debe ser estrictamente futura al crear o modificar.
3. El consumidor no puede elegir el estado de una reserva.
4. Solo `PROGRAMADA` admite modificación o cancelación.
5. La cancelación es lógica; no se elimina la fila.
6. Una reserva reclamada no vuelve automáticamente a `PROGRAMADA`.
7. M7 es degradable; M5 define el resultado de activación.

## Contratos de error

La API responde errores con las propiedades `codigo` y `mensaje`. Los códigos de negocio son `RESERVA_NO_ENCONTRADA`, `RESERVA_NO_MODIFICABLE`, `RESERVA_NO_CANCELABLE`, `FECHA_INVALIDA`, `DATOS_INVALIDOS`, `ERROR_PERSISTENCIA` y `SERVICIO_EXTERNO_NO_DISPONIBLE`.

## Fuera de alcance

- despliegue de M9 en un proveedor cloud;
- autenticación y autorización HTTP de usuarios finales;
- lógica real de despacho de M5;
- algoritmo real de tarifas de M7;
- reintentos automáticos sin contrato idempotente con M5.

## Condición de entrega

La entrega se considera completa cuando API, UI y documentación están disponibles; las imágenes Docker pueden construirse y publicarse; y `npm run test:e2e` levanta Compose, ejecuta el flujo completo y retira los contenedores sin dejar filas temporales.
