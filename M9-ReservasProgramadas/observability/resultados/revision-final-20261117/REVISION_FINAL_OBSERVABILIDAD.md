# Revisión final de observabilidad — M9

Fecha: 17 de noviembre de 2026. Código: commit `b975a3f`. Revisión de la aplicación en ejecución, resultados k6, Grafana Cloud y verificaciones locales. No se modificó el código de la aplicación, los tokens ni las reglas de la cuenta.

## Resultado

**La conexión con Grafana Cloud y k6 funciona.** Se verificaron métricas, logs, trazas y correlación log → traza en la cuenta real. Las 85 pruebas normales aprobaron con Node 22.15.0. También aprobaron los smoke recientes, las seis activaciones del ensayo existente y dos ensayos cortos de estrés.

La entrega aún tiene pendientes: importar y probar las alertas de M9, corregir la fuente Loki seleccionada en los dashboards revisados, el filtro del panel HTTP y la paginación de la pantalla. El comando general `verify` sigue fallando en formato.

## Comprobaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| Node del equipo | `v22.15.0`; resuelto el desfase observado en la revisión anterior |
| Contenedores actuales | M9, M5, M7, PostgreSQL, Redis y RabbitMQ saludables; Alloy en ejecución |
| `/health` | `status: ok` |
| `/readiness` | `ready`; postgres, redis y rabbitmq en `up` |
| Tipos y lint | Aprobaron en la nueva ejecución de `npm run verify` |
| Tests normales | **85/85**, 17 archivos aprobados. El timeout de M7 de la revisión anterior no se reprodujo |
| Formato | `verify` terminó con código 1 en Prettier: 142 archivos señalados, incluidos archivos generados presentes en el árbol actual. No llegó a ejecutar tests; por eso estos se ejecutaron aparte |
| Assets de Grafana | Checker aprobado: 3 dashboards, 58 consultas PromQL y 8 expresiones de alerta. Es una comprobación estática, no acredita importación de reglas |
| Exportador Alloy | En la muestra inicial: 996 logs, 29.549 puntos de métricas y 29.034 spans enviados al gateway de Grafana Cloud; contadores de recepción rechazada en 0. No se observaron errores en el tramo de logs de Alloy revisado |
| Métricas Cloud | General y Procesamiento mostraron datos reales de tráfico, latencia, runtime, dependencias, caché, locks, DB, Outbox y colas |
| Logs Cloud | Explore, fuente `grafanacloud-proudgecko1373-logs`: consulta HTTP devolvió 1.000 líneas visibles, con contexto de correlación y `trace_id` |
| Correlación | Se abrió desde un log la traza `eeec3d4d879426009ae6a1e74dc3c6a1`: `GET /health`, HTTP 200, 24,12 ms. Confirma navegación log → traza; esta muestra no prueba por sí sola el recorrido distribuido completo de una activación |
| Búsqueda de trazas | Explore/Tempo devolvió trazas `scheduler.run` mediante TraceQL |
| Activación k6 existente | 6 resultados ACTIVADA, 100 % de éxito/checks, 0 errores HTTP, p95 de resolución 6,19025 s. Archivo `activation-activation-20261117T072000.json` |

Los contadores de Alloy son acumulados en el momento de observación, no tasas ni resultados exclusivos de una sola prueba. Los paneles de errores pueden mostrar «No data» si todavía no se emitió esa serie; eso no prueba una desconexión.

## Resultados k6

### Smoke ejecutado por el usuario, comprobado en Cloud

[Corrida 9033072](https://proudgecko1373.grafana.net/a/k6-app/runs/9033072): 2 VUs, 30 s, ejecución local con resultados cloud, 288 solicitudes, 0 fallos HTTP, 7/7 thresholds y 720/720 checks. La interfaz Cloud mostró p95 global de 135 ms; el resumen local registró aproximadamente 132,26 ms, por lo que no se presentan ambos valores como una cifra idéntica.

En el resumen local, p95 por operación:

| Operación | p95 |
| --- | ---: |
| Crear | 127,30 ms |
| Consultar por ID | 19,96 ms |
| Listar | 58,62 ms |
| Modificar | 217,96 ms |
| Cancelar | 299,20 ms |

La otra corrida reciente, `9033068`, también tiene resultado local de código 0 y thresholds aprobados. No fue necesario repetir smoke para consumir otra corrida cloud.

### Estrés agregado en esta revisión

Se ejecutó el escenario existente con etapas **2 → 5 → 10 VUs, sostenimiento y descenso**. Son ensayos acotados para verificar el escenario, no una búsqueda del límite máximo del sistema.

| Ensayo | Duración de etapas | Solicitudes | Promedio | Checks | Errores HTTP | Resultado |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `revision-final-stress-20261117`, local | 5 × 15 s | 1.139 | 15,19 req/s | 100 % | 0 % | Código 0 |
| `revision-final-stress-cloud-20261117`, resultados cloud | 5 × 10 s | 801 | 16,00 req/s | 100 % | 0 % | Código 0 |

[Corrida cloud de estrés 9033169](https://proudgecko1373.grafana.net/a/k6-app/runs/9033169). El CLI terminó con thresholds aprobados. En la primera lectura de la página, Cloud mostraba «Finalizing test», ya con las 801 solicitudes, cero fallos y 7/7 thresholds; después de actualizar se observó el estado «Finished». La captura guardada corresponde a la primera lectura, durante la finalización cloud.

En el ensayo con envío cloud, el resumen local informó p95 de creación 123,08 ms, consulta por ID 36,67 ms y listado 60,49 ms. El escenario stress **no ejecuta PATCH ni DELETE**: sus thresholds heredados muestran 0 ms por falta de muestras y no acreditan esas operaciones. El smoke sí las ejecutó.

El primer intento de envío mediante `npm run k6:stress -- --cloud` fue interpretado por npm como configuración y quedó en modo local. Se conservó ese resultado y se ejecutó el envío explícito con `node scripts/run-k6.mjs stress --cloud`. Para reproducir el ensayo cloud desde M9:

```powershell
$env:PROFILE = 'short'
$env:DURATION = '10s'
$env:STRESS_STEPS = '2,5,10'
$env:RUN_ID = 'mi-revision-stress'
try {
    node scripts/run-k6.mjs stress --cloud
} finally {
    Remove-Item Env:PROFILE, Env:DURATION, Env:STRESS_STEPS, Env:RUN_ID -ErrorAction SilentlyContinue
}
```

Generador y aplicación comparten equipo. No se determinaron capacidad máxima, comportamiento prolongado ni punto de saturación. Las pruebas crean datos ficticios que permanecen en la base local; no se ejecutó limpieza destructiva.

## Pendientes concretos

### 1. Importar y demostrar las alertas de M9

En [Alert rules](https://proudgecko1373.grafana.net/alerting/list?search=rule%3AM9), con filtro por nombre M9 y todas las fuentes/estados, Grafana mostró **«No matching rules found»**. No se encontraron las ocho reglas del repositorio con sus nombres previstos. Las numerosas reglas automáticas de la cuenta no sustituyen a las reglas del módulo.

Importar `observability/grafana/alerts/m9-alertas.rules.yaml` mediante el mecanismo Mimir adecuado o crear las reglas Grafana-managed siguiendo `observability/documentacion/05-alertas.md`. Luego demostrar disparo y recuperación en un entorno aislado. No se detuvieron los servicios del usuario para esta revisión.

### 2. Elegir la fuente correcta de logs en los dashboards

En los dashboards General y Procesamiento se observó seleccionada:

`grafanacloud-proudgecko1373-alert-state-history`

Para consultar los registros de M9 corresponde:

`grafanacloud-proudgecko1373-logs` — UID `grafanacloud-logs`.

Cambiar la variable **Logs (Loki)**, comprobar los paneles y guardar la selección predeterminada si el equipo así lo decide. Los enlaces entre dashboards conservan variables: una selección incorrecta puede propagarse al navegar. La selección de Explore usada en esta revisión fue temporal; no se guardó una configuración nueva de dashboard.

### 3. Corregir el filtro del panel HTTP de k6

`scripts/build-grafana-dashboards.mjs:394` sigue usando `| message="http_request"`, pero el evento viaja como Body OTLP, sin atributo `message`. En Cloud se confirmó que la consulta correcta devuelve registros:

```logql
{service_name="m9-reservas"} |= "http_request"
```

Cambiar el generador, regenerar el dashboard y actualizarlo en Cloud. Corregir también el ejemplo correspondiente de la guía anterior. Elegir la fuente Loki correcta no resuelve por sí solo este segundo problema del panel.

### 4. Completar la paginación de la pantalla

`public/app.js:198` continúa cargando `/reservas` sin recorrer páginas. La API entrega 20 registros por defecto y la UI no tiene controles para avanzar. El filtro por estado opera sobre ese subconjunto. Con más de 20 reservas, parte de los datos queda inaccesible desde la pantalla. El código no cambió respecto de la reproducción anterior.

### 5. Normalizar formato y requisitos declarados

Los tests pasan, pero `verify` todavía falla en formato. Revisar finales de línea Windows/LF y el tratamiento de resultados generados en Prettier antes de aplicar un formateo masivo. El requisito Node declarado sigue siendo `>=22`, aunque las dependencias OTel requieren `>=22.15.0`.

También aparece eliminado localmente el archivo versionado `observability/grafana-cloud.env.example`. El archivo real `.env.grafana-cloud` está ignorado y no se encontró versionado. Restaurar una plantilla **sin tokens** facilitará la reproducción en otra computadora; no convertir el archivo real en la plantilla.

### 6. Revisar la presentación de trazas en el dashboard

En Procesamiento, el panel de publicación/consumo mostró «No data», mientras que Explore sí permitió buscar trazas del scheduler y abrir una traza por ID desde Loki. No se confirmó la causa de ese panel: revisar su consulta, rango y resultado en Query inspector antes de atribuirlo a la ingesta. La fuente de trazas sí está recibiendo datos.

## Evidencias guardadas

Carpeta: `observability/resultados/revision-final-20261117/`.

- `tests.log`: 85 pruebas aprobadas.
- `verify.log`: typecheck/lint aprobados y fallo de formato.
- `stress-cloud.log`: primer ensayo, que terminó en ejecución local.
- `stress-envio-cloud.log`: ensayo con envío efectivo a Cloud.
- `k6-cloud.jpg` y `estres-cloud.jpg`: resultados visibles en Grafana.
- `dashboard-general.jpg`: métricas reales.
- `log-traza-cloud.jpg`: correlación Loki/Tempo.
- `scheduler-trazas.jpg`: búsqueda TraceQL.
- `alertas-m9.jpg`: búsqueda sin reglas M9.

Los resúmenes JSON y metadatos de k6 permanecen en `performance/results/`. No se muestran ni se guardan tokens en este informe.

## Alcance del cierre

Se puede demostrar **la ingesta real de las tres señales y el funcionamiento de k6 en Cloud**. Para dar por cerrada toda la entrega, faltan las reglas propias y su prueba, y resolver los detalles de interfaz/paneles y la comprobación de formato. No se cambiaron thresholds para forzar aprobaciones ni se aplicaron correcciones de código durante esta revisión.

Referencia de consulta: [editor de TraceQL de Grafana](https://grafana.com/docs/grafana/latest/datasources/tempo/query-editor/traceql-editor/).
