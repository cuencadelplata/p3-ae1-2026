# Verificacion del 25 de noviembre de 2026

## Recuperacion y concurrencia con infraestructura real

En EC2 se ejecuto un proyecto independiente `m9-infrastructure-tests-a251be90`,
sin puertos publicados ni conexion con la red de la aplicacion. PostgreSQL 17,
Redis 7.4 y RabbitMQ 4.1 reales. Resultado: 17/17 pruebas aprobadas y otra
pasada de 17/17 despues de reiniciar las tres dependencias.

Se comprobo un unico claim entre 32 transiciones concurrentes, una sola clave
durable entre 32 solicitudes concurrentes, recuperacion tras SIGKILL de un proceso
que habia persistido ACTIVANDO, conservacion de su clave, locks con expiracion,
consumidores duplicados, cancelacion contra activacion, Outbox transaccional,
reintentos y DLQ. Tras reinicios se conservaron los datos de control de PostgreSQL
y Redis; RabbitMQ volvio saludable y paso otra vez publicacion/consumo.

El entorno de pruebas fue retirado al terminar. No se detuvo el stack activo.
El ensayo no demuestra reinicio del proceso servidor completo con M5 real ni
asignacion final de conductor. El SIGKILL verifica la recuperacion del claim y
la idempotencia persistida desde un proceso independiente.

Repetir: `COMPOSE_PROJECT_NAME=m9-infrastructure-tests-XXXXXXXX docker compose
-f deployment/aws/compose.recovery-test.yml up --build --abort-on-container-exit
--exit-code-from tests` (reemplazar XXXXXXXX por ocho caracteres hexadecimales).
Retirar solo ese proyecto despues, incluyendo sus volumenes desechables.

## Actualizacion tras merge de main b817275a

Merge en AWS-CloudTest a7de671f y reconstruccion secuencial completados.
Frontend compilado en Docker; contenedores arrancados con espera de salud.
Rutas /conductores/me y /conductores/pendientes devuelven 401 sin identidad.
Las pruebas HTTPS M1/M9 volvieron a pasar (CRUD, fecha pasada y propiedad).
El alta autenticada de conductor devuelve 503: el host Supabase configurado en M3
no resuelve desde el contenedor (DNS ENOTFOUND). La aprobacion y el recorrido con
conductor quedan bloqueados hasta corregir ese proyecto/URL. No se habilito un
fallback para esconder este fallo. RabbitMQ conecta y no aparece el warning Kafka
en los logs de arranque del nuevo M3.

Prueba reproducible: `python3 deployment/aws/driver-profile-check.py`.
No habilita conductores. Las pruebas unitarias M3 no se ejecutaron en el host EC2
porque npm no esta instalado fuera de Docker.

Alcance: M9 y herramientas de despliegue en sa-east-1. Observabilidad excluida por
decision del usuario. No se afirma asignacion ni viaje completo sin M3 operativo.

## Resultados

- 65 pruebas automatizadas aprobadas en 8 archivos: autenticacion y propiedad,
  reservas, concurrencia, recuperacion de activacion, despacho, scheduler y delegacion.
  Estas pruebas usan dependencias controladas; no equivalen a fallos de red en AWS.
- AWS HTTPS: registro/login M1; reserva creada 201, consultada y modificada 200,
  cancelada 200; fecha pasada 400; sin token 401; acceso ajeno GET/PATCH/DELETE 404.
- Activacion real: reserva 93f62518-4849-42fc-ad49-32eeecc194d3 con routeSnapshot
  y tarifa positiva. Solicitud M5 dd543f50-936e-4b13-9fdf-33bdcf9e7b69 consultada
  con 200, estado NO_DRIVERS_AVAILABLE. Reserva FALLIDA; solicitud cancelada al
  terminar. No se probo ACTIVADA ni se inicio un viaje.
- Restauracion aislada sin red: siete dumps PostgreSQL restaurados con
  --exit-on-error; SQLite M1 recuperada e integrity_check OK. Contenedor temporal
  eliminado. Bases activas intactas.
- Tablas restauradas: M2 11, M4 0, M5 0, M6 5, M7 0, M8 17, M9 4.
  Un dump vacio no prueba persistencia del servicio. M5 incluye fallback en memoria;
  debe revisarse su inicializacion Prisma. Supabase no esta cubierto por esos dumps.

## Repetir

Desde /home/ubuntu/movilidad:

```bash
python3 deployment/aws/smoke.py
python3 deployment/aws/activation-check.py
bash deployment/aws/restore-check.sh /home/ubuntu/backup-revision-20261125
```

Las pruebas HTTPS crean clientes identificados como aws-smoke/aws-owner-check.
Cancelan sus reservas o solicitudes; conservan registros para trazabilidad.
No ejecutar cargas intensivas contra la demo mientras otros prueban.

## Pendiente

ACTIVADA y viaje completo dependen de M3. Falta verificar reinicio/caidas reales en
AWS en entorno separado, persistencia de M5, backups de Supabase y cobertura total.
No se reiniciaron servicios compartidos para simular caidas durante esta revision.
RF-9.7 retirado: M9 no exige prioridad por calificacion.
