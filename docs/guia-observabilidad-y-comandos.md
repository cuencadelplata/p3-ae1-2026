# Guía Operativa de Observabilidad y Pruebas — Módulo 8 (AE2)

Esta guía explica paso a paso cómo abrir el tablero de métricas en **Grafana Cloud**, levantar el Módulo 8 y ejecutar las pruebas en vivo con **K6** desde cualquier computadora del equipo para ver el impacto en tiempo real.

---

## 1. Dónde y Cómo Visualizar el Tablero en Grafana Cloud

Antes de ejecutar cualquier comando, abre el tablero en tu navegador para ver la actividad en vivo:

* **URL Directa de Grafana Cloud:** `https://cordialtruck2630.grafana.net`
* **Ruta de acceso:** En el menú lateral izquierdo, haz clic en **Dashboards** y selecciona:
  👉 **`Módulo 8 — Observabilidad, Métricas de Negocio y Contenedor`**
* **Acceso con usuario:** Para poder interactuar con los filtros desplegables, debes ingresar con tu usuario de Grafana Cloud (o la cuenta del equipo).

### Cómo usar los filtros durante la presentación o prueba
En la esquina superior izquierda del tablero verás el selector desplegable **`Filtrar Requerimiento (RF)`**:
* **`All`**: Muestra todo el tráfico unificado de Módulo 8 (`RF8.1` a `RF8.7`).
* **Filtrar por tu requerimiento (`RF8.1`, `RF8.2`, `RF8.3`, etc.)**: Al seleccionar el requerimiento que estás exponiendo, los gráficos de peticiones HTTP, tiempos de respuesta y desglose de operaciones filtran automáticamente el resto y muestran únicamente la actividad de tu subgrupo.

### Qué información verás en pantalla:
1. **Fila 1 (Resumen):** Indicador de estado del contenedor (**ONLINE** en verde en cuanto tu Docker esté enviando datos) y tarjetas con el total de operaciones por requerimiento.
2. **Fila 2 (Tráfico y Latencias):** Gráfico de peticiones por endpoint, tiempo promedio de respuesta en milisegundos y barras horizontales con el detalle de operaciones de negocio en español.
3. **Fila 3 (Recursos y Almacenamiento):** Memoria RAM usada por Node.js, espacio en disco ocupado por PostgreSQL y la aplicación (en MB), y porcentaje de CPU.

---

## 2. Configuración Inicial en tu Computadora (Por Única Vez)

Abre una terminal (**PowerShell**, **Windows Terminal** o la terminal de VS Code) posicionada dentro de la carpeta `modulo-8`:

### Paso 2.1: Sincronizar la rama compartida
```powershell
git checkout ae2/notificaciones-qr-receipts-support
git pull origin ae2/notificaciones-qr-receipts-support
cd modulo-8
```

### Paso 2.2: Instalar dependencias
```powershell
pnpm install
```

### Paso 2.3: Configurar `.env` con credenciales de Grafana Cloud y claves de M8
1. Crea tu archivo `.env` local copiando la plantilla:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Abre `modulo-8/.env` y realiza estas dos configuraciones:
   * **Reemplaza los 3 textos de ejemplo con valores reales** (o pega las claves provistas por el equipo para `QR_INTERNAL_API_KEY`, `M2_INTERNAL_API_KEY` y `M1_JWT_SECRET`). Por seguridad, M8 rechaza iniciar si conservan el prefijo de ejemplo `replace-with-`.
   * **Completa las 3 variables de Grafana Cloud** con las credenciales compartidas por el equipo:
   ```env
   GRAFANA_CLOUD_REMOTE_WRITE_URL=https://prometheus-prod-40-prod-sa-east-1.grafana.net/api/prom/push
   GRAFANA_CLOUD_USER=3757548
   GRAFANA_CLOUD_TOKEN=<TOKEN_PROVISTO_POR_EL_EQUIPO>
   ```

---

## 3. Levantar el Módulo 8 en Docker

Desde la terminal en `modulo-8`, ejecuta:

```powershell
pnpm run ensure:stack
```
*(También puedes ejecutar de forma equivalente: `docker compose --env-file .env up -d --build --wait`).*

Este comando construye y arranca automáticamente los contenedores (`m8-app`, bases de datos, RabbitMQ, sandboxes y el recolector `alloy`).

> **Verificación visual:** Una vez que el comando finalice, mira la pantalla de Grafana Cloud: en pocos segundos la tarjeta superior izquierda cambiará automáticamente a **ONLINE** en verde.

---

## 4. Ejecutar las Pruebas en Vivo con K6 (Smoke Tests)

Con el tablero abierto en Grafana Cloud en una ventana y la terminal en otra, ejecuta los comandos de prueba. 

Los tests corren automáticamente en Docker (no requieren instalar K6 en tu máquina), simulan **1 usuario virtual en 1 pasada limpia** y actualizan los gráficos de Grafana al instante sin saturar la cuota.

### Opción A: Probar TODO el Módulo 8 completo (RF8.1 al RF8.7)
```powershell
pnpm run smoke:all
```
*(Verás en la terminal `13/13 checks passed, 100% success` y verás cómo suben todos los contadores en Grafana).*

---

### Opción B: Probar únicamente el Requerimiento de tu Subgrupo
Si vas a exponer o verificar solo una parte específica, corre el comando correspondiente:

| Comando a ejecutar en `modulo-8` | Requerimiento Funcional | Qué hace la prueba |
| :--- | :--- | :--- |
| `pnpm run smoke:notifications` | **RF8.1** — Notificaciones | Emite una notificación de viaje |
| `pnpm run smoke:qr` | **RF8.2** — QR de verificación | Genera un QR, lo valida con éxito y luego prueba el bloqueo de reuso |
| `pnpm run smoke:receipts` | **RF8.3 y RF8.4** — Comprobantes | Emite comprobante, descarga el PDF y genera enlace temporal de reenvío |
| `pnpm run smoke:support` | **RF8.5 y RF8.6** — Soporte y RabbitMQ | Abre un ticket de soporte y publica un evento en el broker AMQP |
| `pnpm run smoke:delivery` | **RF8.7** — Entrega Push y Tokens | Registra un token de dispositivo Android, lo consulta y lo desactiva |

---

## 5. Coordinación del Equipo y Cuidado de Cuota

El agente `alloy` envía datos a la nube cada 10 segundos. Si varios compañeros tienen `alloy` encendido a la vez con el mismo token, las métricas de ambas máquinas se sumarán en el mismo tablero.

* **Si otro compañero va a probar o exponer:** Pausa el envío de tu máquina sin apagar tus contenedores:
  ```powershell
  docker compose stop alloy
  ```
* **Cuando te toque probar a ti nuevamente:** Reanuda el envío:
  ```powershell
  docker compose start alloy
  ```
* **Al terminar de trabajar:** Apaga todos los contenedores con:
  ```powershell
  pnpm run compose:down
  ```

---

## 6. Directivas para Agentes de Inteligencia Artificial

Si esta guía es leída por un agente de IA en la máquina de otro integrante:

1. **Directorio:** Ejecutar siempre los comandos desde `modulo-8/`.
2. **Gestor de paquetes:** Usar estrictamente `pnpm` (no `npm` ni `yarn`).
3. **Secretos:** Nunca commitear `.env` ni registrar contraseñas en Git.
4. **Ámbito:** No modificar archivos fuera de `modulo-8/`.
5. **Base de datos (Fallback técnico):** Si se reutiliza un volumen antiguo de Postgres donde falta la tabla de soporte, ejecutar: `docker compose exec -T postgres sh /docker-entrypoint-initdb.d/02-support.sh` y reiniciar `docker compose restart m8-app`.
