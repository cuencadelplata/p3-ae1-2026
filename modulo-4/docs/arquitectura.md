# Arquitectura del Modulo 4

## Diagrama de componentes

```mermaid
flowchart LR
  M3[M3 Conductores] -. contrato / driverId .-> API
  M5[M5 Solicitud y Despacho] -->|buscar candidatos y cambiar disponibilidad| API[M4 API REST]
  M6[M6 Ciclo del viaje] -. inicio y fin del viaje .-> API
  UI[M4 UI - Nginx] -->|REST / JSON| API
  API --> MEM[(Estado temporal en memoria + TTL)]
  DEV[Docente / desarrollador] -->|OpenAPI| SCALAR[Scalar]
  SCALAR --> API
```

La UI y la API son aplicaciones y contenedores independientes. Nginx sirve los archivos de la UI y redirige las solicitudes `/api`, `/health` y `/docs` al contenedor de la API.

## Diagrama de secuencia del recorrido critico

```mermaid
sequenceDiagram
  actor Conductor
  participant UI as M4 UI
  participant API as M4 API
  participant M5 as M5 Despacho

  Conductor->>UI: Publica coordenadas y disponibilidad
  UI->>API: PUT /drivers/{id}/location
  API-->>UI: Ubicacion con updatedAt y expiresAt
  M5->>API: GET /drivers/nearby
  API-->>M5: Candidatos ordenados, distancia y ETA
  M5->>API: PATCH /drivers/{id}/availability
  API-->>M5: Conductor no disponible
```

## Caso concurrente

Dos actualizaciones del mismo conductor pueden llegar fuera de orden por latencia de red. Antes de guardar, M4 compara la marca temporal recibida con `updatedAt`. Si el mensaje es anterior, devuelve `409 STALE_LOCATION_UPDATE` y conserva la ubicacion mas reciente.
