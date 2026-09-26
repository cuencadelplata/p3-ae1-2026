

## 📦 1. Imágenes publicadas en Docker Hub

### M5 — Solicitud y Despacho (`agustinq19/m5-dispatch-service`)

```powershell
# Listar imágenes locales del módulo 5
docker image ls agustinq19/m5-dispatch-service
```

**Etiquetas disponibles:** `v0.6`, `v1.0`, `v1.1`, `latest`

```powershell
# Descargar todas las versiones
docker pull agustinq19/m5-dispatch-service:v0.6
docker pull agustinq19/m5-dispatch-service:v1.0
docker pull agustinq19/m5-dispatch-service:v1.1
docker pull agustinq19/m5-dispatch-service:latest
```

---

## 🚀 2. Ejecutar la imagen final publicada

```powershell
# Levantar el contenedor M5 en background
docker run --rm -d --name m5-demo-final -p 3005:3005 agustinq19/m5-dispatch-service:latest

# Esperar a que el servicio esté listo
Start-Sleep -Seconds 3

# Verificar que el contenedor esté corriendo
docker ps --filter "name=m5-demo-final"
```

**Resultado esperado:** columna `PORTS` muestra `0.0.0.0:3005->3005/tcp`

---

## ❤️ 3. Verificar salud del servidor

```powershell
Invoke-WebRequest http://localhost:3005/health -UseBasicParsing
```

**Resultado esperado:**
- `StatusCode: 200`
- Body: `{"status":"UP","service":"m5-dispatch-service","timestamp":"..."}`

---

## 🌐 4. Interfaces del servicio — Abrir en navegador

### Página principal (Interfaz HTML)

```powershell
Start-Process "http://localhost:3005/"
```

### OpenAPI Spec (YAML)

```powershell
Start-Process "http://localhost:3005/openapi/openapi-m5.yaml"
```

| Interfaz       | URL                                           | Descripción                           |
|----------------|-----------------------------------------------|---------------------------------------|
| Página inicial | http://localhost:3005/                         | Interfaz HTML del servicio            |
| OpenAPI YAML   | http://localhost:3005/openapi/openapi-m5.yaml  | Especificación OpenAPI del módulo 5   |

---

## 🧪 5. Ejecutar pruebas (desde `modulo-5/`)

> ⚠️ **Importante:** Todos los comandos de test deben ejecutarse
> desde la carpeta `modulo-5/`.

### Tests unitarios

```powershell
cd modulo-5
npm run test:unit
```

Archivos de test unitario:
- `tests/unit/ride-request-service.unit.test.ts`
- `tests/unit/ride-request-validator.unit.test.ts`

### Tests de integración

```powershell
npm run test:integration
```

Archivo de test de integración:
- `tests/integration/ride-request-api.integration.test.ts`

### Tests unitarios + integración (todos)

```powershell
npm test
```

### Tests e2e (Playwright)

```powershell
npm run test:e2e
```

Archivo de test e2e:
- `tests/e2e/dispatch-flow.e2e.test.ts`

> **Nota:** Los tests e2e levantan automáticamente un servidor local en
> el puerto `3055` (definido en `playwright.config.ts`).

### Tests con cobertura (Jest)

```powershell
npx jest --coverage
```

---

## 🛑 6. Detener el contenedor

```powershell
docker stop m5-demo-final
```

---

## 🧹 7. Limpieza final (opcional)

```powershell
# Detener el contenedor de demo si quedó activo
docker stop m5-demo-final 2>$null

# Verificar que no queden contenedores corriendo
docker ps

# (Opcional) Eliminar las imágenes descargadas
docker rmi agustinq19/m5-dispatch-service:v0.6
docker rmi agustinq19/m5-dispatch-service:v1.0
docker rmi agustinq19/m5-dispatch-service:v1.1
docker rmi agustinq19/m5-dispatch-service:latest
```
