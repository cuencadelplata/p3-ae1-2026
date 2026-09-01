# Política de fecha y hora

- La API acepta `fechaHoraProgramada` como ISO 8601/RFC 3339 con offset explícito, por ejemplo `2026-09-02T14:30:00-03:00` o `2026-09-02T17:30:00Z`.
- Zod rechaza formatos sin offset, fechas inválidas y valores que no sean estrictamente futuros al momento de procesar la solicitud.
- Supabase persiste el valor en `timestamptz`; PostgreSQL opera en `UTC` y normaliza el instante sin perder su significado temporal.
- Las respuestas utilizan la representación ISO entregada por Supabase, normalmente en UTC.
- El scheduler compara `fecha_hora_programada <= now` usando un `Date` convertido a ISO. No realiza comparaciones de texto locales ni depende de la zona horaria del contenedor.
- Una reserva cuya fecha vence durante una ejecución se recoge en esa ejecución o en la siguiente, según el instante exacto de la consulta.
- `RESERVATION_JOB_INTERVAL` es una expresión cron; el default es cada 30 segundos (`*/30 * * * * *`).

La validación de “fecha futura” corresponde a creación y modificación. Una reserva ya almacenada puede naturalmente quedar en el pasado antes de que el scheduler la active.
