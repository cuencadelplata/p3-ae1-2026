create type public.tipo_vehiculo as enum ('AUTO', 'MOTO');

create type public.estado_reserva as enum (
  'PROGRAMADA',
  'ACTIVANDO',
  'ACTIVADA',
  'CANCELADA',
  'FALLIDA'
);

create table public.reservas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null,
  origen text not null,
  destino text not null,
  vehiculo public.tipo_vehiculo not null,
  fecha_hora_programada timestamptz not null,
  estado public.estado_reserva default 'PROGRAMADA',
  tarifa_estimada numeric,
  moneda varchar default 'ARS',
  criterio_asignacion text default 'MEJOR_CALIFICACION',
  id_solicitud uuid,
  creado_en timestamptz default now(),
  actualizado_en timestamptz default now()
);

alter table public.reservas enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger
  on table public.reservas
  to anon, authenticated, service_role;

create policy "lectura_propias_reservas"
  on public.reservas
  for select
  to public
  using ((select auth.uid()) = cliente_id);

create policy "creacion_propias_reservas"
  on public.reservas
  for insert
  to public
  with check ((select auth.uid()) = cliente_id);

create policy "actualizacion_solo_programadas"
  on public.reservas
  for update
  to public
  using (
    (select auth.uid()) = cliente_id
    and estado = 'PROGRAMADA'::public.estado_reserva
  )
  with check ((select auth.uid()) = cliente_id);
