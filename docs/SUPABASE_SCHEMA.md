# Auditoría del esquema Supabase

Auditoría de solo lectura realizada el 1 de septiembre de 2026 sobre el proyecto `Modulo9:Reservas` (`dxbbwquhwpzgdjhepdvv`). Supabase es la fuente de verdad. No se creó otro proyecto, no se aplicó DDL y no se deshabilitó RLS.

## Inventario

- PostgreSQL 17.6, zona horaria `UTC`.
- PostgREST 14.5 según los tipos TypeScript generados.
- Única tabla de negocio en `public`: `reservas`.
- La tabla tenía 0 filas al auditarla.
- No hay migraciones registradas por Supabase.
- Tipos generados y versionados en `src/types/database.ts`.

## Matriz modelo conceptual → esquema real

| Concepto M9 | Columna real | Tipo real | Nulo | Default | Uso en M9 |
| --- | --- | --- | --- | --- | --- |
| Identificador | `id` | `uuid` | No | `gen_random_uuid()` | PK y recurso REST |
| Cliente | `cliente_id` | `uuid` | No | — | `clienteId` |
| Origen | `origen` | `text` | No | — | `origen` |
| Destino | `destino` | `text` | No | — | `destino` |
| Vehículo | `vehiculo` | `tipo_vehiculo` | No | — | `AUTO` o `MOTO` |
| Fecha programada | `fecha_hora_programada` | `timestamptz` | No | — | ISO 8601 con offset |
| Estado | `estado` | `estado_reserva` | Sí | `PROGRAMADA` | El backend nunca escribe `null` |
| Tarifa estimada | `tarifa_estimada` | `numeric` | Sí | — | Puede quedar nula si M7 falla |
| Moneda | `moneda` | `varchar` | Sí | `ARS` | Respuesta de M7 o `ARS` |
| Criterio | `criterio_asignacion` | `text` | Sí | `MEJOR_CALIFICACION` | Conserva el default existente |
| Solicitud M5 | `id_solicitud` | `uuid` | Sí | — | Se completa al activar |
| Creación | `creado_en` | `timestamptz` | Sí | `now()` | Solo lectura desde M9 |
| Actualización | `actualizado_en` | `timestamptz` | Sí | `now()` | M9 lo actualiza explícitamente |

No fue necesario crear columnas ni adaptar el modelo con datos paralelos.

## Enums

- `public.tipo_vehiculo`: `AUTO`, `MOTO`.
- `public.estado_reserva`: `PROGRAMADA`, `ACTIVANDO`, `ACTIVADA`, `CANCELADA`, `FALLIDA`.

## Claves, constraints e índices

- PK: `reservas_pkey`, `PRIMARY KEY (id)`.
- Índice: únicamente el btree único de la PK `reservas_pkey`.
- No existen FK, constraints `CHECK` ni constraints `UNIQUE` adicionales.
- `cliente_id` se trata como identificador externo; no se inventó una FK.
- Las reglas fecha futura y origen distinto de destino se validan en Zod y en el servicio.

El scheduler funciona correctamente sin un índice adicional. Para volumen alto se recomienda, como cambio futuro y medido, un índice compuesto sobre `(estado, fecha_hora_programada)`.

## Triggers y funciones

- No hay triggers por fila en `public.reservas`; por eso M9 escribe `actualizado_en` en cada cambio.
- Event trigger activo `ensure_rls`, evento `ddl_command_end`, enlazado a `public.rls_auto_enable()`.
- `public.rls_auto_enable()` es `SECURITY DEFINER`, propiedad de `postgres`, y usa `search_path = pg_catalog`.
- La función tiene `EXECUTE` para `PUBLIC`, `anon`, `authenticated`, `postgres` y `service_role`.

Los advisors de seguridad advierten que una función `SECURITY DEFINER` ejecutable por `anon` y `authenticated` queda expuesta como RPC. La remediación queda pendiente porque cambiar grants modifica el esquema compartido: [advisor 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) y [advisor 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## RLS y permisos

RLS está habilitado en `public.reservas` (`FORCE RLS` no está habilitado).

| Política | Operación | Roles | `USING` | `WITH CHECK` |
| --- | --- | --- | --- | --- |
| `lectura_propias_reservas` | SELECT | `public` | `auth.uid() = cliente_id` | — |
| `creacion_propias_reservas` | INSERT | `public` | — | `auth.uid() = cliente_id` |
| `actualizacion_solo_programadas` | UPDATE | `public` | `auth.uid() = cliente_id AND estado = 'PROGRAMADA'` | `auth.uid() = cliente_id` |

No existe política DELETE, consistente con la cancelación lógica de M9. `anon`, `authenticated` y `service_role` tienen grants de tabla `SELECT`, `INSERT`, `UPDATE` y `DELETE`; los grants permiten alcanzar la tabla y RLS decide qué filas puede operar cada rol.

El advisor de rendimiento recomienda envolver `auth.uid()` como `(select auth.uid())` en las tres políticas para evitar reevaluación por fila: [advisor 0003](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan). Es una optimización futura, no un bloqueo funcional.

## Credencial del backend

M9 no expone Supabase a los clientes. `SUPABASE_KEY` debe contener una clave secreta/server-side con privilegios equivalentes a `service_role`, porque el scheduler no tiene una sesión de usuario y necesita reclamar reservas de distintos clientes. Nunca debe utilizarse en frontend, logs, OpenAPI o commits.

Una clave publishable/anon no sirve para este proceso de backend: sin JWT de usuario, las políticas basadas en `auth.uid()` no permiten operar filas. En una futura integración con Supabase Auth, los endpoints de usuario deberán propagar identidad y reducir privilegios donde sea posible.

## Reclamo atómico

No se agregó una RPC. El repositorio ejecuta una única sentencia lógica mediante PostgREST:

```text
UPDATE reservas
SET estado = 'ACTIVANDO', actualizado_en = ...
WHERE id = ... AND estado = 'PROGRAMADA'
RETURNING ...
```

Dos workers pueden leer la misma reserva pendiente, pero Postgres vuelve a evaluar la condición del `UPDATE` bajo el bloqueo de fila. Solo uno obtiene una fila devuelta; el otro obtiene cero. La suite unitaria comprueba los filtros y la suite live opt-in valida el comportamiento contra Supabase real.

## Cambios pendientes, no aplicados

1. Revocar `EXECUTE` de `rls_auto_enable()` a roles que no lo necesiten.
2. Optimizar las tres políticas con `(select auth.uid())`.
3. Evaluar un índice `(estado, fecha_hora_programada)` con datos y `EXPLAIN`.
4. Considerar `NOT NULL` para `estado`, `creado_en` y `actualizado_en` si el equipo adopta una migración formal.

Estos puntos no impiden una implementación correcta y por eso no se cambió la base silenciosamente.
