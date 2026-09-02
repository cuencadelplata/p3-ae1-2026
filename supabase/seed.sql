-- Datos completamente ficticios para comprobar la carga reproducible del entorno local.
insert into public.reservas (
  id,
  cliente_id,
  origen,
  destino,
  vehiculo,
  fecha_hora_programada,
  estado,
  tarifa_estimada,
  moneda
)
values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Terminal local',
  'Aeropuerto local',
  'AUTO',
  '2099-01-01T12:00:00Z',
  'PROGRAMADA',
  2500,
  'ARS'
);
