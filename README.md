# Módulo 3: Conductores y Valoraciones (p3-ae1-2026)

Módulo M3 para la gestión de conductores y valoraciones de movilidad urbana, desarrollado para la cátedra **Paradigmas y Lenguajes de Programación III (AE1 - 2026)**.

---

## 🚀 Puesta en marcha

### Opción 1: Con Docker Compose (Recomendada)
Levanta Redis, la API Backend en Node.js y el Frontend en Nginx:

```bash
docker compose up -d
```

- **Frontend (Test Runner & Swagger UI):** [http://localhost:4000](http://localhost:4000)
- **API Backend (vía proxy frontend):** [http://localhost:4000/api](http://localhost:4000/api)
- **API Backend directa:** [http://localhost:5000/api](http://localhost:5000/api)
- **Redis:** `localhost:6379`

### Opción 2: Local con Node.js
```bash
npm install
npm start
```
- **Frontend & API:** [http://localhost:3000](http://localhost:3000)
- **Health Check:** [http://localhost:3000/health](http://localhost:3000/health)

---

## 🧪 Pruebas End-to-End (E2E) con Playwright

El proyecto cuenta con una suite completa de pruebas E2E automatizadas con **Playwright** que validan tanto la interfaz de usuario interactiva como los contratos REST de la API.

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `npm run test:e2e` | Ejecuta la suite completa de pruebas E2E en modo headless |
| `npm run test:e2e:ui` | Abre la interfaz visual interactiva de Playwright Test UI |
| `npm run test:e2e:headed` | Ejecuta las pruebas en el navegador visible en tiempo real |
| `npm run test:e2e:report` | Abre el reporte HTML con métricas, trazas y capturas |

### Estructura de las pruebas

- **`tests/e2e/frontend.spec.js`**:
  - Carga inicial del panel interactivo (Test Runner), títulos y controles.
  - Verificación de conectividad con el botón de Ping hacia el backend (`#serverStatusBadge`).
  - Ejecución de peticiones interactivas:
    - `GET /conductores`: listado y respuesta 200 OK.
    - `GET /conductores/{id}`: consulta con ID existente (`cond_001`).
    - `GET /conductores/{id}`: manejo de error 404 para ID inexistente.
    - `POST /conductores/`: alta de nuevo conductor con payload dinámico y validación 201 Created.
    - `GET /conductor/valoraciones`: consulta de reseñas mediante query params.
    - `POST /conductor/valoraciones`: registro de valoración con puntaje y comentario.
  - Registro de peticiones en el historial y funcionalidad de borrado.
  - Alternancia entre el modo **Test Runner** y **Swagger UI**.

- **`tests/e2e/api.spec.js`**:
  - `GET /health`: estado del módulo y conexión a Redis.
  - `GET /api/conductores`: estructura y lista de conductores.
  - `GET /api/conductores/:id`: obtención individual y caso de error 404.
  - `POST /api/conductores`: creación exitosa (201) y validación de body vacío (400).
  - `GET /api/conductor/valoraciones`: obtención por ID y validación de parámetros faltantes (400).
  - `POST /api/conductor/valoraciones`: registro válido y validación de rango de puntaje 1-5 (400).
