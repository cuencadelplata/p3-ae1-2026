# Módulo 3: Conductores y Valoraciones (p3-ae1-2026)

Módulo M3 para la gestión de conductores y valoraciones de movilidad urbana, desarrollado para la cátedra **Paradigmas y Lenguajes de Programación III (AE1 - 2026)**.

Los comandos de esta guía se ejecutan dentro de `M3-Conductor`.

---

## Puesta en marcha

### Opción 1: Con Docker Compose (recomendada)

Levanta Redis, RabbitMQ, la API en Node.js, el consumidor de eventos de ejemplo y el frontend en Nginx:

```bash
cd M3-Conductor
docker compose up -d --build
```

- **Frontend (Test Runner y Swagger UI):** [http://localhost:4000](http://localhost:4000)
- **API por el proxy del frontend:** [http://localhost:4000/api](http://localhost:4000/api)
- **API directa:** [http://localhost:5000/api](http://localhost:5000/api)
- **Health check:** [http://localhost:5000/health](http://localhost:5000/health)
- **Redis:** `localhost:6379`
- **RabbitMQ (AMQP):** `localhost:5672`
- **RabbitMQ Management:** [http://localhost:15672](http://localhost:15672) (`admin` / `admin123`)
- **Consumidor de ejemplo:** `docker compose logs -f consumer`

### Opción 2: Local con Node.js

Redis y RabbitMQ tienen que estar corriendo. Se pueden levantar solo esos dos servicios con Docker:

```bash
cd M3-Conductor
docker compose up -d redis rabbitmq
npm install
npm start
```

- **Frontend y API:** [http://localhost:3000](http://localhost:3000)
- **Health check:** [http://localhost:3000/health](http://localhost:3000/health)
- **Consumidor de ejemplo:** `npm run consumer` (requiere RabbitMQ en `RABBITMQ_URL`)

En el panel, cambiá **Base URL** a `http://localhost:3000/api`. El valor por defecto (`http://localhost:4000/api`) corresponde a Docker.

---

## 📨 Mensajería asíncrona con RabbitMQ (RNF-07)

M3 publica eventos en el exchange topic `m3.conductores.events` cada vez que cambia el estado de un conductor:

| Evento | Routing key | Se emite cuando |
|---|---|---|
| `DriverAvailabilityUpdated` | `driver.availability.updated` | `PUT /api/conductores/:id/disponible` cambia la disponibilidad (RF 3.3) |
| `DriverStatusChanged` | `driver.status.changed` | `PUT /api/conductores/:id/habilitado` cambia la habilitación (RF 3.1) |

- **Producer:** `M3-Conductor/src/events/eventPublisher.js` (publisher confirms, mensajes persistentes).
- **Consumidor de ejemplo:** `M3-Conductor/src/consumers/driverEventsConsumer.js` (cola propia, `ack` manual).
- **Contrato completo de los eventos:** [`M3-Conductor/docs/EVENTOS.md`](M3-Conductor/docs/EVENTOS.md).

---

## Probar con el frontend

El panel está en `M3-Conductor/public/index.html`.

1. Abrí [http://localhost:4000](http://localhost:4000) si usás Docker, o [http://localhost:3000](http://localhost:3000) si usás `npm start`.
2. Confirmá la **Base URL** (`http://localhost:4000/api` o `http://localhost:3000/api`).
3. Tocá el botón de refresco junto a la URL. El indicador pasa a verde cuando la API responde.
4. En **Test Runner**, elegí un endpoint, cargá datos de prueba si pide body y enviá la petición.
5. La respuesta HTTP y el JSON aparecen a la derecha.

La pestaña **Swagger UI** documenta la misma API REST.

Endpoints del panel:

- `GET /conductores` y `GET /conductores/{id}`
- `POST /conductores/`
- `GET /conductor/valoraciones` y `POST /conductor/valoraciones`

Esas rutas leen y escriben las valoraciones ya registradas (`conductor:{id}:valoraciones`). No muestran la valoración pendiente que genera el evento de viaje finalizado.

---

## Valoración habilitada al finalizar un viaje

Cuando el módulo de viajes publica `viaje.finalizado`, M3 hace lo siguiente:

1. El consumidor escucha el exchange `viajes.events`, routing key `viaje.finalizado`, cola `valoraciones.viaje-finalizado`.
2. Valida `viajeId`, `conductorId` y `clienteId`.
3. Guarda la valoración en Redis con la clave `valoracion:pendiente:{viajeId}` y estado `PENDIENTE`.
4. Publica `valoracion.habilitada` en el exchange `valoraciones.events`, routing key `valoracion.habilitada`, cola `cliente.valoracion-habilitada`.

Para disparar el evento sin el módulo de viajes, con la API ya iniciada:

```bash
npm run mock:viaje-finalizado
```

El mensaje publicado queda en la cola `cliente.valoracion-habilitada`. Se puede ver en RabbitMQ Management. El panel web no consume esa cola: el aviso al cliente lo tiene que leer el módulo que se suscriba a `valoracion.habilitada`.

En el evento guardado, `evaluadorId` es el conductor y `evaluadoId` es el cliente.

---

## Pruebas end-to-end con Playwright

Suite E2E que cubre el Test Runner y los contratos REST. Se ejecuta desde `M3-Conductor`, con la API y Redis disponibles.

| Comando | Descripción |
|---|---|
| `npm run test:e2e` | Suite completa, sin ventana del navegador |
| `npm run test:e2e:ui` | Interfaz de Playwright |
| `npm run test:e2e:headed` | Pruebas con el navegador visible |
| `npm run test:e2e:report` | Reporte HTML con trazas y capturas |

- **`tests/e2e/frontend.spec.js`:** carga del panel, ping al backend, `GET` y `POST` de conductores y valoraciones, historial y cambio entre Test Runner y Swagger UI.
- **`tests/e2e/api.spec.js`:** `GET /health`, CRUD de conductores y validaciones de valoraciones (parámetros faltantes y puntaje fuera de 1–5).
