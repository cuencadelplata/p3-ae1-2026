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

Para poder ver en producción este módulo a través de Docker, se deben seguir los siguientes pasos:

1- Tener Docker desktop instalado y corriendo.  
2- Hacer login o crearse una cuenta (en caso de no tener).  
3- A través de Powershell (abierto como administrador), descargar la imagen a través del siguiente comando:  
```powershell
docker pull agustinq19/m5-dispatch-service:latest
```
4- Luego ejecutar el contenedor:  
```powershell
docker run -p 3005:3005 agustinq19/m5-dispatch-service:latest
```
5- Abrir el localhost con la dirección dada:
- **Simulador y Dashboard:** `http://localhost:3005`
- **Healthcheck:** `http://localhost:3005/health`
- **Especificación OpenAPI:** `http://localhost:3005/openapi/openapi-m5.yaml`

---

### Ejecución Local desde Código Fuente

#### Prerrequisitos
- **Node.js**: v20.x o superior.
- **npm**: v10.x o superior.
- **Docker & Docker Compose** *(opcional para despliegue en contenedores)*.

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

### 3. Ejecución con Docker y Docker Compose

```bash
# Levantar el contenedor en segundo plano
docker compose up --build -d

# Verificar logs del servicio
docker compose logs -f

# Comprobar el estado del contenedor
docker compose ps

# Detener el contenedor
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


