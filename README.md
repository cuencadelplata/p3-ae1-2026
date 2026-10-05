# Paradigmas de Programación III — AE1 (2026)
## Módulo 5: Servicio de Solicitud y Despacho

## Integrantes

- **Integrantes:** Lautaro Romero Stach, Agustin Quetglas, Santino Mortola y    Matias Costantini

## Descripción General

Este repositorio contiene la implementación del **Módulo 5 (Solicitud y Despacho)** para la plataforma distribuida de movilidad urbana.

El microservicio se encarga de gestionar el ciclo de vida completo de las solicitudes de viaje de los pasajeros, la búsqueda inteligente y geográfica de conductores cercanos, la emisión concurrente de ofertas con tiempo de caducidad (TTL), la asignación atómica con resolución de carreras de concurrencia y la cancelación controlada de viajes.

---

## Requerimientos 

### Requerimientos Funcionales (RF)
- **RF-5.1: Solicitud de Viaje:**
  - Registro de origen y destino con validación de coordenadas geográficas válidas (`[-90, 90]`, `[-180, 180]`).
  - Validación de distancia mínima (> 100 metros).
  - Selección de tipo de vehículo (`AUTO` o `MOTO`).
  - Integración (Mockup) con cálculo estimado de tarifa y tiempo (M7).
  - Prevención de solicitudes simultáneas activas por el mismo cliente.
- **RF-5.2: Búsqueda de Candidatos:**
  - Integración (Mockup) con el servicio de geolocalización (M4).
  - Filtrado de conductores disponibles por cercanía, radio de cobertura (`radiusKm`) y límite de candidatos (`maxCandidates`).
- **RF-5.3: Despacho de Ofertas con TTL (Timeout):**
  - Generación de ofertas de viaje con tiempo límite de respuesta configurable (por defecto 60s, rango 5s a 180s).
  - Transición automática y control de estado (`OFFERED`, `EXPIRED`, `ACCEPTED`, `REJECTED`, `CANCELLED`).
- **RF-5.4: Respuesta a Ofertas por Conductores:**
  - Endpoints dedicados para aceptar (`ACCEPT`) o rechazar (`REJECT`) una oferta vigente.
  - Validación estricta de conductor destinatario y vigencia de la oferta.
- **RF-5.5: Asignación Exclusiva y Resolución de Concurrencia:**
  - Mecanismo atómico para evitar doble asignación (*race conditions*): el primer conductor en responder favorablemente se adjudica el viaje.
  - Cancelación/expiración inmediata del resto de las ofertas vinculadas al viaje.
- **RF-5.6: Cancelación de Solicitud de Viaje:**
  - Permite al cliente cancelar la solicitud antes de que el viaje sea asignado o durante el despacho.
  - Registro opcional de motivo de cancelación y liberación automática de ofertas pendientes.

---

## Instrucciones de Instalación y Ejecución

Para levantar el microservicio y su documentación interactiva a través de Docker:

#### Opción Recomendada: Docker Compose (Despliegue multi-contenedor)
```powershell
# Dentro de la carpeta modulo-5:
cd modulo-5
docker compose up --build -d
```

#### Opción Alternativa: Docker Run individual
```powershell
# 1. Microservicio de Despacho
docker run -d -p 3005:3005 --name m5-dispatch agustinq19/m5-dispatch-service:latest
```

Una vez iniciado, podés acceder a:
- **Simulador y Dashboard:** `http://localhost:3005`
- **Documentación Interactiva (Scalar - Contenedor dedicado):** `http://localhost:3006` *(con Docker Compose)*
- **Documentación Interactiva (Scalar - Ruta integrada):** `http://localhost:3005/docs`
- **Healthcheck del Servicio:** `http://localhost:3005/health`
- **Especificación OpenAPI en YAML:** `http://localhost:3005/openapi/openapi-m5.yaml`


---

### Ejecución Local desde Código Fuente

#### Prerrequisitos
- **Node.js**: v20.x o superior.
- **npm**: v10.x o superior.
- **Docker & Docker Compose** *(para despliegue desacoplado en contenedores)*.

#### 1. Ejecución Local (Desarrollo)

```bash
# Ingresar al directorio del módulo
cd modulo-5

# Instalar dependencias
npm install

# Iniciar servidor en modo desarrollo (recarga en caliente con ts-node)
npm run dev
```

El servicio estará disponible en:
- **API Base:** `http://localhost:3005`
- **Documentación Interactiva (Scalar):** `http://localhost:3005/docs` (o `/reference`)
- **Healthcheck:** `http://localhost:3005/health`
- **Simulador Interactivo:** `http://localhost:3005/`
- **OpenAPI Spec:** `http://localhost:3005/openapi/openapi-m5.yaml`

---

### 2. Compilación y Ejecución en Producción

```bash
# Compilar TypeScript a JavaScript estándar
npm run build

# Iniciar el bundle generado
npm start
```

---

### 3. Ejecución Desacoplada con Docker Compose (Contenedores Separados)

La arquitectura con Docker Compose implementa desacoplamiento total en dos contenedores independientes:
1. **`m5-dispatch-service`** (`puerto 3005`): Microservicio de backend y lógica de negocio.
2. **`m5-scalar-docs`** (`puerto 3006`): Servidor Nginx Alpine ultraligero que aloja la interfaz gráfica de Scalar para explorar y probar los endpoints.

```bash
# Ingresar a modulo-5 (o ejecutar apuntando al compose)
cd modulo-5

# Levantar todos los servicios en segundo plano
docker compose up --build -d

# URLs disponibles:
# - API & Simulador:     http://localhost:3005
# - Scalar Docs UI:      http://localhost:3006
# - Healthcheck:         http://localhost:3005/health

# Verificar logs de ambos contenedores
docker compose logs -f

# Comprobar el estado de los contenedores
docker compose ps

# Detener los servicios
docker compose down
```

---

## Ejecución de Pruebas

El proyecto cuenta con una cobertura integral de pruebas dividida en tres niveles:

```bash
cd modulo-5

# 1. Ejecutar toda la suite de pruebas (Unitarias + Integración)
npm test

# 2. Ejecutar únicamente pruebas unitarias (Lógica de dominio, Haversine, validadores)
npm run test:unit

# 3. Ejecutar pruebas de integración (HTTP REST con Supertest)
npm run test:integration

# 4. Ejecutar pruebas End-to-End con Playwright
npm run test:e2e
```

### Resumen de Pruebas Automatizadas
- **107 pruebas automatizadas** que cubren:
  - Casos de éxito y validaciones de frontera.
  - Validación de distancias geográficas y errores semánticos (422).
  - Manejo y resolución de colisiones de idempotencia (409).
  - Expiración estricta de ofertas por TTL.
  - Concurrencia de múltiples conductores aceptando la misma solicitud simultáneamente.
  - Cancelaciones previas y rechazo de ofertas.

---

## Automatización de Release y Empaquetado (`release.ps1`)

Para automatizar la creación de releases estables y facilitar la entrega entre integrantes o entornos de evaluación:

```powershell
# Ejecutar desde la carpeta modulo-5 indicando la versión
.\release.ps1 -Version "1.0"
```

El script realiza de manera automática los siguientes pasos:
1. Comprueba que el árbol de trabajo de Git esté limpio.
2. Crea el tag de Git correspondiente (`v1.0`).
3. Construye la imagen Docker con los tags `p3-ae1/m5-dispatch-service:v1.0` y `latest`.
4. Publica el tag al repositorio remoto (`git push origin v1.0`).
5. Exporta el archivo empaquetado `releases/v1.0.tar` para importación directa mediante `docker load -i releases/v1.0.tar`.

---

## Simulador y Dashboard Interactivo

Al iniciar el servicio e ingresar a `http://localhost:3005/`, se cuenta con una interfaz web completa para:
- Simular la creación de viajes eligiendo origen y destino en mapa interactivo.
- Ver en vivo el despacho de ofertas a los conductores candidatos con cuenta regresiva de TTL.
- Simular la aceptación o rechazo en tiempo real desde la perspectiva de múltiples conductores.
- Demostrar visualmente la resolución de condiciones de carrera (Race Condition) y asignación única.
- Inspeccionar el log de eventos estructurados y estado de la base de datos en memoria.

---

## Actividad de Evaluación 2 (AE2) — Evolución Individual v2.0

- **Alumno:** Agustín Quetglas
- **Rama individual:** `ae2/agustin-quetglas`
- **Módulo:** Módulo 5 (Solicitud y Despacho)
- **Alcance Funcional Individual:** `RF-5.1: Solicitud de viaje`

### 1. Decisiones Arquitectónicas y Tecnológicas (AE2)

| Componente | Rol en RF-5.1 | Decisión y Justificación |
| :--- | :--- | :--- |
| **PostgreSQL (`m5-postgres-db`)** | Persistencia Relacional (`dispatch_db`) | Propiedad estricta de datos (RNF-04). Persistencia transaccional duradera con historial inmutable (append-only). Puerto `5432`. |
| **Redis (`m5-redis`)** | Estado Efímero y Concurrencia | Candado atómico `SET NX EX 180` para evitar solicitudes concurrentes por cliente (RNF-09), idempotencia distribuida con TTL de 24h (RNF-08), invalidación explícita (`DEL`) al cancelar/asignar y caché efímero de tarifas (60s) (RNF-06). Puerto `6379`. |
| **RabbitMQ (`m5-rabbitmq`)** | Mensajería Asíncrona Desacoplada | Publicación de evento de dominio `ride.requested` en exchange `mobility.events` (topic durable) con sobre canónico acordado con Módulo 8 (RNF-07). Panel Web en puerto `15672` (guest/guest), AMQP en puerto `5672`. |
| **Integración Síncrona (M7)** | Estimación de Tarifa | Consumo HTTP POST al endpoint oficial `/tarifa/estimacion` del Módulo 7 con timeout y fallback resiliente local. |
| **Alias de Compatibilidad** | Interoperabilidad entre Módulos | Exposición de `GET /viajes/:requestId` y `GET /api/v1/viajes/:requestId` como alias hacia `GET /api/v1/ride-requests/:requestId` para compatibilidad hacia atrás. |

### 2. Instrucciones de Ejecución Reproducible (Docker Compose)

Para levantar toda la infraestructura completa de AE2 en un solo paso:

```powershell
cd modulo-5
docker compose up --build -d
```

#### Servicios Activos:
* **App / Simulador M5:** [http://localhost:3005](http://localhost:3005)
* **Diagnóstico de Salud (Healthcheck RNF-16):** [http://localhost:3005/health](http://localhost:3005/health) *(monitorea estado de Redis y RabbitMQ)*
* **Documentación Scalar:** [http://localhost:3005/docs](http://localhost:3005/docs) y [http://localhost:3006](http://localhost:3006)
* **Panel de Administración RabbitMQ:** [http://localhost:15672](http://localhost:15672) (`guest` / `guest`)
* **Base de Datos PostgreSQL:** `localhost:5432` (`dispatch_db`, user: `postgres`, pass: `postgres`)
* **Redis en Memoria:** `localhost:6379`

### 3. Pruebas y Validación

```powershell
cd modulo-5
npm test
```
* **Cobertura:** 116 tests unitarios y de integración pasando al 100% en 5 suites (incluye pruebas específicas de Redis con TTL/locks y RabbitMQ con sobre canónico).
