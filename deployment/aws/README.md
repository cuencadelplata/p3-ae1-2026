# AWS CloudTest

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
Completar allí, por privado, `M3_SUPABASE_URL`, `M3_SUPABASE_SERVICE_ROLE_KEY`,
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
