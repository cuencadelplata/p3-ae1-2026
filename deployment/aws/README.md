# AWS CloudTest

## CI/CD automatico

Repositorio de despliegue: `cuencadelplata/p3-ae1-2026` (remoto `origin`).
Publicar cambios con `git push origin AWS-CloudTest`. El temporizador automatico
queda deshabilitado por decision del usuario; el despliegue actual es manual.

Cada push a `AWS-CloudTest` ejecuta `AWS CloudTest CI` (M9, frontend y M3).
EC2 consulta su resultado cada cinco minutos y despliega solo el HEAD exacto con
CI aprobado. Un CI pendiente o fallido no cambia los contenedores. No despliega
main ni pull requests. GitHub no recibe claves SSH ni el archivo privado.

El entorno sigue en `/home/ubuntu/movilidad/deployment/aws/.env`. Cada release
tiene checkout propio en `/home/ubuntu/movilidad-cd/releases/SHA`; el enlace
`/home/ubuntu/movilidad-cd/current` identifica el ultimo despliegue correcto.
Para comandos manuales posteriores usar ese directorio. El proyecto Compose y
los volumenes conservan su nombre `movilidad-aws`.

Estado: `systemctl status movilidad-cd.timer` y
`journalctl -u movilidad-cd.service --no-pager -n 80`.
Pausar despliegues: `sudo systemctl stop movilidad-cd.timer`.
Reintentar ahora: `sudo systemctl start movilidad-cd.service`.
No hay rollback automatico ni migraciones destructivas de datos. Si falla el
arranque, revisar logs; el marcador SHA solo cambia al pasar salud y HTTPS.
Las releases se conservan para recuperacion y requieren mantenimiento de disco.
El repositorio debe continuar publico para consultar GitHub sin token.

Resultados reproducibles y limites: [VERIFICACION.md](VERIFICACION.md).
Restauracion aislada: `bash deployment/aws/restore-check.sh DIRECTORIO_BACKUP`.
No restaura sobre las bases activas ni publica puertos.

## Entornos centrales

El Compose compartido usa `.env` en local y `deployment/aws/.env` en AWS.
M3 y M7 reciben variables explicitamente; el Compose compartido ya no carga sus
archivos privados separados. Los Compose independientes de cada modulo conservan
su configuracion propia por compatibilidad.

Local: `docker compose --env-file .env up -d --build`.
AWS: `bash deployment/aws/deploy.sh check` y `bash deployment/aws/deploy.sh up`.
Las variables Supabase de M7 se llaman `M7_SUPABASE_URL` y `M7_SUPABASE_KEY`;
la SQL local se llama `M7_DATABASE_URL`. No usar un host `db` sin un servicio real
con ese nombre. En AWS se usa `m7-db`, creado por el overlay.

`consolidate-env.mjs` permite migrar los valores de M7 existentes. Conserva las
claves de motores y solo sustituye campos AWS ausentes o marcados como placeholder.
No sincroniza EC2 ni cambia usuarios en los motores.

Infraestructura creada en São Paulo (`sa-east-1`): instancia
`i-07c64b9137e9e8e14`, Elastic IP `56.126.65.182` y dominio base
`56-126-65-182.sslip.io`. La infraestructura anterior de Virginia fue reemplazada.
La creacion de la instancia no instala Docker ni publica la aplicacion.

M7 se construye desde el codigo del repositorio. AWS le asigna PostgreSQL privado
`m7-db` con volumen propio y password generado (`M7_DB_PASSWORD`). Las operaciones
actuales de pagos e historial siguen usando el Supabase configurado de M7.
Tras generar el entorno, `node deployment/aws/import-m7.mjs` importa sus claves
desde `modulo7/.env` sin imprimirlas. No reemplaza la clave interna compartida de AWS.

Comprobacion HTTPS (crea un cliente de prueba):
`python3 deployment/aws/smoke.py`.

Despliegue de demostración en una EC2 Ubuntu 24.04 x86_64, 8 GB de RAM y 80 GB gp3.
Conserva Compose; sólo Caddy publica 80/443. Una única EC2 no ofrece alta disponibilidad del servidor.

## 1. Preparar la infraestructura

Perfil local: `AWS-CloudTest`. Cuenta esperada: `295552411532`. Región: São Paulo (`sa-east-1`).
Antes de crear recursos, revisar créditos, vencimiento, precio regional y alertas de consumo en AWS Budgets.
`ec2.yml` crea una EC2, firewall y Elastic IP; no despliega automáticamente la aplicación.
Requiere VPC, subred pública, un par de claves y tu IP pública `/32`.

Validar sin crear recursos:

```powershell
aws sts get-caller-identity --profile AWS-CloudTest --query Account --output text
aws cloudformation validate-template --profile AWS-CloudTest --region sa-east-1 --template-body file://deployment/aws/ec2.yml
```

Crear el stack desde CloudFormation subiendo `ec2.yml`, tras revisar sus parámetros y costos.
El resultado `DomainBase` sirve para el paso siguiente. Si tenés dominio propio, apuntar
`app`, `reservas` y `m8` a la Elastic IP. HTTPS requiere DNS correcto y acceso entrante a 80/443.

## 2. Generar el entorno privado

En tu PC, con Node instalado, reemplazar dominio y email:

```powershell
node deployment/aws/prepare.mjs 1-2-3-4.sslip.io tu-email@example.com
```

Genera `deployment/aws/.env`, ignorado por Git. No sobrescribe claves existentes.
Completar allí, por privado, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (M3),
`M7_SUPABASE_URL`, `M7_SUPABASE_KEY`, `MP_ACCESS_TOKEN`,
`M8_SMTP_USER`, `M8_SMTP_PASSWORD` y `M8_MAIL_FROM`. La contraseña SMTP debe ser
una contraseña de aplicación nueva; no reutilizar una que haya sido publicada o compartida.

Grafana Cloud es opcional. Para habilitarlo, completar
`GRAFANA_CLOUD_REMOTE_WRITE_URL`, `GRAFANA_CLOUD_USER` y
`GRAFANA_CLOUD_TOKEN` con un token recién emitido. Nunca reutilizar un token expuesto.
Para la demostración de pagos usar credenciales de PRUEBA de Mercado Pago.
`MP_PUBLIC_KEY` habilita tarjeta en la interfaz; dejarla vacía permite efectivo/transferencia.
Las claves internas nuevas ya quedan sincronizadas. El despliegue usa M7 real, no el sandbox.

## 3. Preparar EC2

```powershell
ssh -i TU-CLAVE.pem ubuntu@TU-IP
```

Dentro de EC2:

```bash
git clone --branch AWS-CloudTest https://github.com/cuencadelplata/p3-ae1-2026.git
cd p3-ae1-2026
bash deployment/aws/setup-host.sh
exit
```

Volver a conectar por SSH. Copiar el entorno privado desde tu PC:

```powershell
scp -i TU-CLAVE.pem deployment/aws/.env ubuntu@TU-IP:~/p3-ae1-2026/deployment/aws/.env
```

## 4. Validar y levantar

En EC2, desde el repositorio:

```bash
bash deployment/aws/deploy.sh check
bash deployment/aws/deploy.sh up
bash deployment/aws/deploy.sh status
```

El script construye un servicio por vez y conserva los datos en volúmenes separados
del stack local (`movilidad-aws`). Nunca ejecutar `down --volumes` sobre datos que quieras conservar.
No mostrar `docker compose config` completo: contiene secretos; usar `config --quiet`.

Abrir `https://app.DOMINIO-BASE`, `https://reservas.DOMINIO-BASE` y `https://m8.DOMINIO-BASE`.
Registrar cuentas nuevas: las bases locales no se copian. Los proveedores OAuth externos
requieren registrar también la URL HTTPS de retorno del frontend en Google/Auth0.
SMTP requiere las credenciales de M8; tener HTTPS y claves VAPID no habilita correo por sí solo.

## 5. Apagar

## Administracion, backups y evidencias

Desde `/home/ubuntu/movilidad`, el comando reproducible es
`bash deployment/aws/dc.sh --profile m3 logs --tail 100 SERVICIO` o
`bash deployment/aws/dc.sh --profile m3 up -d --no-deps SERVICIO`.
No se requiere un alias `dc` ni ejecutar `restart` para aplicar variables nuevas.

Backup completo local: `bash deployment/aws/backup.sh /home/ubuntu/backup-FECHA`.
El destino debe ser nuevo. Incluye siete PostgreSQL y SQLite M1 con backup online,
verifica catalogos, integridad SQLite y hashes. Copiarlo fuera de EC2 y probar una
restauracion aislada antes de considerar el respaldo recuperable. No cubre los datos
externos de Supabase, que requieren su propio respaldo.

Para rotar una clave externa, crear reemplazo, actualizar consumidores, comprobar
funcionamiento y finalmente revocar la anterior. JWT puede cerrar sesiones y VAPID
requiere renovar suscripciones. Para PostgreSQL/RabbitMQ se debe cambiar tambien la
credencial dentro del motor; editar solo `.env` no modifica usuarios existentes.

La observabilidad de M9 queda fuera del despliegue AWS actual.

Costos: registrar consumo bruto, creditos y costo neto con fecha de consulta. Costo
neto cero puede incluir creditos y retrasos de facturacion; no significa consumo cero.
La asignacion completa sigue pendiente de M3. RF-9.7 fue eliminado: no validar una
prioridad por calificacion como requisito de M9.

```bash
bash deployment/aws/deploy.sh down
```

Detener contenedores no detiene el cobro de EC2. Detener la instancia desde AWS corta
el cómputo, pero EBS y la Elastic IP siguen generando cargos. Eliminar el stack termina
la EC2 y elimina su disco: respaldar antes las bases. El despliegue no certifica por sí
solo el recorrido funcional completo ni constituye una auditoría de seguridad de todos los módulos.

Referencias: [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [Ubuntu AMI](https://documentation.ubuntu.com/aws/aws-how-to/instances/build-cloudformation-templates/).

## Inicio sin M3

M3 queda desactivado por defecto mediante el perfil `m3`. El frontend puede
iniciar, pero las operaciones de conductores y vehiculos no estaran disponibles;
no se puede validar el recorrido completo de asignacion hasta incorporar M3.
Para incorporarlo, completar sus credenciales y ejecutar
`COMPOSE_PROFILES=m3 bash deployment/aws/deploy.sh up`.

SMTP es opcional: dejar usuario, password y remitente vacios para iniciar sin
correo. Si se configura alguno, deben completarse los tres. La recuperacion de
cuentas por correo requiere SMTP operativo. M7 conserva sus requisitos reales.
