# 🚀 Guía Paso a Paso para Terminal: Docker, Endpoints, OpenAPI y Tests

Esta guía detalla los comandos exactos para revisar imágenes de Docker, levantar la aplicación, verificar la salud del servicio, consultar la documentación OpenAPI y ejecutar los tests automatizados desde la terminal.

---

## 📌 Paso 0: Ubicación en la Terminal

```powershell
cd c:\Users\Usuario\Documents\GitHub\p3-ae1-2026\m8-soporte
```

---

## 1. 📦 Ver la lista de versiones e imágenes de Docker

Para listar las imágenes de Docker almacenadas localmente y ver sus versiones (tags) y tamaños:

```powershell
docker images
```

Para filtrar específicamente las imágenes de este módulo:

```powershell
docker images | Select-String "m8-soporte"
```

---

## 2. 🐳 Levantar y ejecutar las imágenes con Docker

### 2.1 Detener/limpiar contenedores previos
```powershell
docker compose down
```

### 2.2 Reconstruir y levantar el entorno (Microservicio + RabbitMQ)
```powershell
docker compose up --build -d
```

### 2.3 Verificar que los contenedores estén corriendo y saludables
```powershell
docker ps
```

---

## 3. 🌐 Probar Health Check, Endpoints y OpenAPI por Terminal

### 3.1 Probar el Health Check (`/health`)
```powershell
curl.exe http://localhost:3000/health
```
*O usando PowerShell:*
```powershell
Invoke-RestMethod http://localhost:3000/health
```

### 3.2 Probar la Ruta Raíz (`/`)
```powershell
curl.exe http://localhost:3000/
```

### 3.3 Crear un nuevo ticket de prueba (`POST /tickets`)
###Comando recomendado en PowerShell (`Invoke-RestMethod`)
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/tickets" -Method Post -ContentType "application/json" -Body '{"viajeId":"viaje-demo","motivo":"Prueba de RabbitMQ"}'

### 3.4 Publicar eventos a RabbitMQ para Monitorear la Cola (`POST /events/publish`)
Para enviar eventos o ráfagas de mensajes (ej. 10 mensajes juntos) y visualizar la curva de actividad en el gráfico de **Queued messages** en RabbitMQ Management (`http://localhost:15672`):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/events/publish" -Method Post -ContentType "application/json" -Body '{"routingKey":"viaje.completado","payload":{"viajeId":"viaje-burst-100","importe":2500},"count":10}'
```

### 3.5 Listar todos los tickets (`GET /tickets`)
```powershell
curl.exe http://localhost:3000/tickets
```

### 3.6 Consultar la especificación OpenAPI (Swagger)
* **Interfaz visual (Swagger UI):** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
* **Ver archivo RAW en formato YAML por HTTP:** [http://localhost:3000/openapi.yaml](http://localhost:3000/openapi.yaml)
* **Ver archivo RAW en formato JSON por HTTP:** [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)
* **Leer archivo YAML local por terminal:**
```powershell
curl.exe http://localhost:3000/openapi.yaml
```

---

## 4. 📊 Monitoreo en RabbitMQ Management Console

1. Abrir en el navegador: [http://localhost:15672](http://localhost:15672) (Usuario: `guest` | Clave: `guest`).
2. Ir a la pestaña **Queues and Streams** -> seleccionar `m8_async_events`.
3. Ejecutar la ráfaga de prueba con `Invoke-RestMethod` (ver punto 3.4).
4. Se observará que:
   - 1 mensaje entra en estado **Unacknowledged** durante 3 segundos (del valor simulado en `consumer.ts`).
   - Los otros 9 mensajes permanecen en estado **Ready** en la cola.
   - El gráfico **Queued messages** mostrará una curva clara de 10 -> 9 -> 8 -> ... -> 0 a lo largo de 30 segundos.

---

## 5. 🧪 Ejecutar la Suite de Tests por Terminal

Para ejecutar los 17 casos de prueba unitarios e integrales:

```powershell
pnpm test
```
---

