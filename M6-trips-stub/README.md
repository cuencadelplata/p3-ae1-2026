# Trips Stub — Simulador de M6 (Viajes)

Servidor de prueba que simula respuestas del módulo M6 (Viajes y Ciclo de Vida), para que otros módulos (como M7 - Historial Financiero) puedan desarrollarse y probarse sin depender de la implementación real de M6, que aún no existe en este repositorio.

Devuelve siempre datos fijos de ejemplo (no consulta ninguna base de datos real).

## Instalación

```bash
npm install
```

## Ejecutar en local

```bash
npm run build
npm start
```

El servidor queda escuchando en `http://localhost:4000`.

## Ejecutar con Docker

```bash
docker build -t trips-stub .
docker run -p 4000:4000 trips-stub
```

## Endpoint

| Método | Ruta          | Descripción                          |
|--------|---------------|----------------------------------------|
| GET    | `/trips/{id}`  | Devuelve datos fijos de un viaje simulado |

### Ejemplo

```bash
curl http://localhost:4000/trips/viaje_123
```

Respuesta:

```json
{
  "id": "viaje_123",
  "status": "completed",
  "distanceKm": 8.5,
  "durationMinutes": 22,
  "vehicleType": "economy"
}
```

## Estado

Este servicio es un **stub** — representa temporalmente al módulo M6 mientras no está implementado. La conexión real entre M7 y M6 queda planificada para una versión posterior.