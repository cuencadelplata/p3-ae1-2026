# 🚀 Guía Paso a Paso para Terminal: Docker, Endpoints, OpenAPI y Tests

Esta guía detalla los comandos exactos para revisar imágenes de Docker, levantar la aplicación, verificar la salud del servicio, consultar la documentación OpenAPI y ejecutar los tests automatizados desde la terminal.

---

## 📌 Paso 0: Ubicación en la Terminal

Asegúrate de ejecutar todos los comandos estando dentro de la carpeta del módulo `m8-soporte`:

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
```powershell
curl.exe -X POST http://localhost:3000/tickets -H "Content-Type: application/json" -d "{\"viajeId\":\"viaje-demo-999\", \"motivo\":\"Problema con el cobro\"}"
```

### 3.4 Listar todos los tickets (`GET /tickets`)
```powershell
curl.exe http://localhost:3000/tickets
```

### 3.5 Consultar la especificación OpenAPI (Swagger)
* **Interfaz visual (Swagger UI):** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
* **Ver archivo RAW en formato YAML por HTTP:** [http://localhost:3000/openapi.yaml](http://localhost:3000/openapi.yaml)
* **Ver archivo RAW en formato JSON por HTTP:** [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)
* **Leer archivo YAML local por terminal:**
```powershell
curl.exe http://localhost
:3000/openapi.yaml
```

---

## 4. 🧪 Ejecutar la Suite de Tests por Terminal

Para ejecutar los 15 casos de prueba unitarios e integrales:

```powershell
pnpm test
```
*Alternativas si prefieres usarlas:*
```powershell
npm test
# o
npx vitest run
```

---

## 🛑 5. Detener los Contenedores

Al finalizar la prueba, puedes apagar los servicios ejecutando:

```powershell
docker compose down
```
