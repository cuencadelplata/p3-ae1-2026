# Guía Operativa de Observabilidad y Pruebas — Módulo 8 (AE2)

Esta guía documenta paso a paso el procedimiento para configurar, levantar, probar y visualizar la observabilidad y métricas del **Módulo 8 (Notificaciones, QR, Comprobantes, Soporte y Entrega Push)** en tiempo real mediante **Grafana Cloud** y pruebas de humo con **K6**.

El documento está estructurado para que pueda ser ejecutado tanto por un integrante del equipo como por un agente de inteligencia artificial (Cursor, Claude Code, Copilot, Antigravity, etc.) siguiendo instrucciones deterministas.

---

## 1. Requisitos Previos en la Máquina Local

Antes de iniciar, verificar que el entorno cumpla con:

1. **Docker Desktop** (o Docker Engine con plugin Compose v2) encendido y funcionando.
2. **Node.js 24** y gestor de paquetes **pnpm 10.33.0** instalados.
3. Clon del repositorio posicionado en la rama de trabajo compartida.

---

## 2. Paso a Paso: Configuración del Entorno Local

Todos los comandos deben ejecutarse desde una terminal posicionada en la carpeta `modulo-8`.

### Paso 2.1: Sincronizar el repositorio y entrar a `modulo-8`
```powershell
git checkout ae2/notificaciones-qr-receipts-support
git pull origin ae2/notificaciones-qr-receipts-support
cd modulo-8
```
*(En Linux/macOS usar el equivalente `cd modulo-8`). El directorio de trabajo debe ser `.../p3-ae1-2026/modulo-8`.*

### Paso 2.2: Instalar dependencias con pnpm
```powershell
pnpm install
```

### Paso 2.3: Configurar variables de entorno y credenciales de Grafana Cloud
1. Crear el archivo `.env` a partir de la plantilla:
   ```powershell
   Copy-Item .env.example .env
   ```
   *(En Linux/macOS: `cp .env.example .env`).*

2. Abrir `modulo-8/.env` y completar las variables de exportación a Grafana Cloud (solicitar las credenciales al equipo por canal privado; nunca commitear el archivo `.env` con secretos reales):
   ```env
   GRAFANA_CLOUD_REMOTE_WRITE_URL=https://prometheus-prod-40-prod-sa-east-1.grafana.net/api/prom/push
   GRAFANA_CLOUD_USER=3757548
   GRAFANA_CLOUD_TOKEN=<TOKEN_PROVISTO_POR_EL_EQUIPO>
   ```

---

## 3. Paso a Paso: Levantamiento del Módulo 8 en Docker

### Paso 3.1: Iniciar el stack unificado
Ejecutar el script automatizado que construye las imágenes y levanta todos los servicios:

```powershell
pnpm run ensure:stack
```

Este comando levanta:
* `m8-app`: Contenedor unificado de Módulo 8 (puerto local `3000`).
* `postgres`: Base de datos relacional para comprobantes, soporte y tokens.
* `redis`: Almacén atómico para códigos QR y validaciones de un solo uso.
* `rabbitmq`: Broker de eventos para mensajería asíncrona (`mobility.events`).
* `alloy`: Agente recolector de métricas que hace scrape a `m8-app:3000/metrics` y las envía a Grafana Cloud cada 10 segundos.
* Sandboxes auxiliares: `fiscal-sandbox`, `m1-identity-sandbox`, `m7-payments-sandbox`.

### Paso 3.2: Verificación de salud y primer arranque de base de datos
1. Verificar que el servicio responda localmente:
   ```powershell
   curl http://localhost:3000/health/ready
   ```
   Debe responder con código HTTP 200 y JSON indicando estado `ok` o `degraded`.

2. **Resolución de problemas de esquema persistente (si aplica):**
   Si en la máquina ya existía un volumen Docker previo de PostgreSQL (`modulo-8_m8_postgres_data`) y no se crearon las tablas de soporte, ejecutar este comando una sola vez para forzar la migración:
   ```powershell
   docker compose exec -T postgres sh /docker-entrypoint-initdb.d/02-support.sh
   docker compose restart m8-app
   ```

---

## 4. Paso a Paso: Ejecución de Pruebas de Humo en Vivo con K6

Los tests corren automáticamente dentro de un contenedor Docker efímero con la imagen oficial de K6. No es necesario instalar binarios de K6 en la computadora local.

Cada script simula **1 usuario virtual realizando 1 iteración limpia**, validando el flujo de negocio y generando las métricas exactas en el tablero sin saturar la cuota gratuita de Grafana Cloud.

### Opción A: Probar todo el Módulo 8 completo (RF8.1 a RF8.7)
Ejecutar:
```powershell
pnpm run smoke:all
```
*Resultado esperado:* 13 comprobaciones exitosas (`13/13 checks passed, 100% success`), 0 fallos de HTTP, duración aproximada de 1.5 a 3 segundos.

### Opción B: Probar únicamente el Requerimiento que expone cada subgrupo
Si durante la defensa o revisión solo se desea demostrar un subgrupo específico, utilizar el comando correspondiente:

| Comando | Requerimientos | Endpoints probados | Métricas generadas |
| :--- | :--- | :--- | :--- |
| `pnpm run smoke:notifications` | **RF8.1** (Notificaciones) | `POST /notifications` | `notification_requested` |
| `pnpm run smoke:qr` | **RF8.2** (Códigos QR) | `POST /qr`<br>`POST /qr/validate` (válido)<br>`POST /qr/validate` (409 reuso) | `qr_code_issued`<br>`qr_code_redeemed`<br>`qr_code_reuse_rejected` |
| `pnpm run smoke:receipts` | **RF8.3 y RF8.4** (Comprobantes) | `POST /api/v1/receipts`<br>`GET /api/v1/receipts/:tripId/pdf`<br>`GET /internal/receipts/:tripId/delivery-reference` | `receipt_issued`<br>`receipt_pdf_downloaded`<br>`receipt_resend_link_generated` |
| `pnpm run smoke:support` | **RF8.5 y RF8.6** (Soporte y AMQP) | `POST /tickets`<br>`POST /events/publish` | `support_ticket_created`<br>`amqp_event_published` |
| `pnpm run smoke:delivery` | **RF8.7** (Entrega Push y Tokens) | `POST /devices/tokens`<br>`GET /devices/tokens`<br>`DELETE /devices/tokens/:token` | `device_token_registered`<br>`device_token_deactivated` |

---

## 5. Visualización del Tablero en Grafana Cloud y Filtros

### Acceso al Tablero
* **URL:** `https://cordialtruck2630.grafana.net`
* **Navegación:** Menú lateral -> **Dashboards** -> Abrir **`Módulo 8 — Observabilidad, Métricas de Negocio y Contenedor`**.
* **Permisos para interactuar con filtros:** Los usuarios deben ingresar autenticados al stack (solicitar invitación por correo al administrador o usar las credenciales del equipo). Los enlaces públicos de solo lectura de Grafana deshabilitan las variables interactivas.

### Uso del Selector de Requerimiento (Filtro RF)
En la parte superior izquierda del tablero se encuentra el desplegable **`Filtrar Requerimiento (RF)`**:
* **`All`**: Muestra todo el tráfico unificado del Módulo 8.
* **Selección puntual (`RF8.1`, `RF8.2`, `RF8.3`, etc.)**: Al seleccionar un requerimiento específico, todos los gráficos de latencia, tráfico HTTP y operaciones de negocio ocultan el resto y se enfocan exclusivamente en ese requerimiento.

### Estructura de Paneles del Tablero
1. **Fila 1 — Resumen Operativo por Requerimiento:**
   * Estado del contenedor `m8-app` (**ONLINE** en verde cuando emite métricas).
   * Tarjetas numéricas con total de operaciones acumuladas por requerimiento funcional.
2. **Fila 2 — Actividad de Endpoints, Latencias y Métricas de Negocio:**
   * Gráfico temporal de peticiones HTTP por ruta normalizada y código de estado.
   * Gráfico de tiempo de respuesta promedio por endpoint (en milisegundos).
   * Gráfico de barras horizontales con el desglose de operaciones de negocio en español y estado de ejecución.
3. **Fila 3 — Salud del Contenedor y Almacenamiento:**
   * Memoria RAM residente (RSS) y memoria heap usada por el proceso Node.js (en MB).
   * Almacenamiento ocupado en disco por PostgreSQL y datos de la aplicación (en MB).
   * Porcentaje de uso de CPU del contenedor.

---

## 6. Coordinación del Equipo y Cuidado de la Cuota (Grafana Alloy)

El servicio `alloy` envía las métricas de `m8-app` a la nube cada 10 segundos. Si múltiples integrantes corren `alloy` simultáneamente en computadoras distintas con el mismo token, las métricas de ambas máquinas se sumarán en el mismo tablero.

### Reglas operativas:
1. **Un solo emisor a la vez:** El integrante que esté ejecutando pruebas o demostrando en vivo debe ser el único con el contenedor `alloy` activo.
2. **Pausar el envío a Grafana Cloud sin apagar la aplicación:**
   ```powershell
   docker compose stop alloy
   ```
   *(La aplicación `m8-app` y la base de datos continúan funcionando normalmente en local).*
3. **Reanudar el envío a Grafana Cloud:**
   ```powershell
   docker compose start alloy
   ```
4. **Apagar todos los contenedores al terminar:**
   ```powershell
   pnpm run compose:down
   ```

---

## 7. Directivas de Ejecución para Agentes de Inteligencia Artificial

Si esta guía es leída por un agente de IA en la máquina de otro integrante, el agente debe seguir estrictamente estas directivas:

1. **Directorio de trabajo:** Ejecutar siempre los comandos desde `modulo-8/`.
2. **Gestor de paquetes:** Utilizar exclusivamente `pnpm` (no usar `npm` ni `yarn`; no modificar `pnpm-lock.yaml`).
3. **Variables de entorno:** Nunca commitear `modulo-8/.env` ni exponer las claves de Grafana Cloud en mensajes públicos o commits de Git.
4. **Validación de entorno:** Si los tests de K6 fallan en endpoints de soporte (`POST /tickets`), verificar primero si el esquema de PostgreSQL requiere inicialización ejecutando `docker compose exec -T postgres sh /docker-entrypoint-initdb.d/02-support.sh`.
5. **No interferir con otros módulos:** No modificar carpetas fuera de `modulo-8/` ni ramas que no pertenezcan al Grupo 6.
