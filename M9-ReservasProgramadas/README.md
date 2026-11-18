# M9 — Reservas Programadas

Guía para **Windows / PowerShell**. Requisitos: Node.js **22.15+ de la rama 22, o 24+**, npm y Docker Desktop iniciado, sin pausar, con contenedores Linux y Compose **2.24.4+**.

## 1. Instalar

Desde la raíz del repositorio:

```powershell
cd M9-ReservasProgramadas
npm ci
npm run db:generate
```

**Los demás comandos se ejecutan dentro de M9.**

## 2. Levantar Docker: M9 + M5 + M7

```powershell
npm run integration:config
npm run integration:up
npm run integration:check
Invoke-RestMethod http://localhost:3000/readiness
Start-Process 'http://localhost:3000'
Start-Process 'http://localhost:3000/docs/'
```

La demo no requiere `.env`: genera sus credenciales en `.integration/`, ignorada por Git. Usar el cliente **`99999999-9999-4999-8999-999999999999`**. La ruta es fija de demostración; M5 y M7 son reales. Docker aplica las migraciones al iniciar.

Opcional, para usar M4 real: `npm run integration:up -- --with-m4`.

## 3. Pruebas locales

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:coverage
npm run test:infrastructure
npm run integration:check
```

`npm test` no necesita Cloud. `test:infrastructure` prueba PostgreSQL, Redis y RabbitMQ con Docker en un proyecto separado. `integration:check` necesita los contenedores del paso 2.

## 4. Grafana Cloud

Una sola vez, crear o editar **`observability/.env.grafana-cloud`**. Si ya está configurado, omitir este paso:

```powershell
notepad .\observability\.env.grafana-cloud
```

Reemplazar los marcadores por los datos de tu stack:

```dotenv
GRAFANA_CLOUD_OTLP_ENDPOINT=https://ENDPOINT-DEL-STACK/otlp
GRAFANA_CLOUD_OTLP_INSTANCE_ID=INSTANCE_ID
GRAFANA_CLOUD_OTLP_TOKEN=TOKEN_OTLP
K6_CLOUD_TOKEN=TOKEN_K6
K6_CLOUD_STACK_ID=STACK_ID
K6_CLOUD_PROJECT_ID=PROJECT_ID
```

El token OTLP necesita `metrics:write`, `logs:write` y `traces:write`. Las variables `K6_CLOUD_*` se usan solo para enviar resultados k6 a Cloud. **No subir este archivo a Git.**

```powershell
npm run integration:obs:config
npm run integration:obs:up
npm run integration:check
npm run obs:dashboards:check
```

En **Grafana Cloud**:

1. **Dashboards → Import**: cargar `observability/grafana/dashboards/m9-observabilidad.json`. Sobrescribir si ya existe.
2. Seleccionar las fuentes de **métricas (Prometheus/Mimir), logs (Loki) y trazas (Tempo)**.
3. Abrir las pestañas RF o diagnóstico; seleccionar **Últimos 15 minutos** y actualización automática.
4. Generar tráfico con el paso 5 y esperar al menos 15 segundos para la exportación.

`http://localhost:12345` muestra Alloy; el dashboard se abre en Grafana Cloud. Para regenerar el JSON: `npm run obs:dashboards:build`.

## 5. Carga y estrés con k6

Con Docker levantado, ejecutar **una prueba por vez**. Localmente no requieren tokens ni instalar k6.

| Comando                  | Prueba                                           |
| ------------------------ | ------------------------------------------------ |
| `npm run k6:smoke`       | CRUD básico                                      |
| `npm run k6:load`        | Carga habitual                                   |
| `npm run k6:parallel`    | 10 usuarios × lotes de 5 solicitudes simultáneas |
| `npm run k6:concurrency` | Operaciones sobre las mismas reservas            |
| `npm run k6:stress`      | Carga creciente y recuperación                   |
| `npm run k6:spike`       | Dos picos bruscos y recuperación                 |
| `npm run k6:breakpoint`  | Saturación: de 10 a 400 solicitudes/s            |
| `npm run k6:soak`        | Carga sostenida durante 15 minutos               |
| `npm run k6:cache`       | Caché fría y caliente                            |
| `npm run k6:activation`  | Activación al horario programado                 |
| `npm run k6:dispatch`    | Despacho a M5                                    |
| `npm run k6:repricing`   | Recotización con M7                              |

Primera prueba de límite reducida para una PC de 6 GB:

```powershell
$env:PROFILE = 'short'
$env:BREAKPOINT_RPS = '10,25,50,100'
$env:MAX_VUS = '50'
try {
    npm run k6:breakpoint
} finally {
    Remove-Item Env:PROFILE, Env:BREAKPOINT_RPS, Env:MAX_VUS -ErrorAction SilentlyContinue
}
```

Para ver **también los resultados del generador** en Grafana Cloud k6:

```powershell
npm run k6:parallel:cloud
npm run k6:breakpoint:cloud
npm run k6:soak:cloud
```

Otros escenarios: `node scripts/run-k6.mjs smoke --cloud`, reemplazando `smoke` por el deseado. En Cloud k6 abrir la corrida y comparar p95/p99, errores, usuarios y fases. Con Alloy activo, el dashboard M9 recibe métricas/logs/trazas aun con k6 local.

Resultados: **`performance/results/`**, ignorada por Git. Código **99**: umbrales incumplidos; se conserva el resultado. `dropped_iterations`: carga que k6 no logró iniciar, no demuestra por sí sola el límite de M9. Las pruebas dejan datos y la cancelación es lógica. La asignación final requiere conductores disponibles y aceptación en M5.

## 6. Estado, logs y detener

```powershell
docker ps
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/readiness
docker logs --tail 100 movilidad-urbana-m9-reservas-1
docker logs --tail 100 movilidad-urbana-alloy-1
npm run integration:obs:stop
```

Sin observabilidad: `npm run integration:stop`. Si se inició M4, agregar `-- --with-m4` al comando de detención. Se conservan datos y volúmenes; para reiniciar, repetir `integration:up` o `integration:obs:up`. Si un nombre de contenedor difiere, obtenerlo con `docker ps`.
