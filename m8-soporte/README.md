# Módulo 8: Notificaciones, Documentos y Soporte (m8-soporte)

Microservicio encargado de la gestión de tickets de soporte, notificaciones y consumo asíncrono de eventos mediante RabbitMQ.

## Requisitos Previos

- [Docker](https://www.docker.com/) y Docker Compose instalados.
- [Node.js](https://nodejs.org/) v20+ (para desarrollo local opcional sin contenedores).

## Ejecución Local con Docker Compose

Para levantar el microservicio y el contenedor de RabbitMQ de forma orquestada y reproducible:

```bash
docker compose up --build -d
```

### Puertos y Servicios Expuestos

- **API de Soporte:** `http://localhost:3000`
- **Panel de Administración RabbitMQ:** `http://localhost:15672` (Usuario: `guest`, Contraseña: `guest`)
- **Broker RabbitMQ AMQP:** `amqp://localhost:5672`

### Detener Contenedores

```bash
docker compose down
```

## Desarrollo Local (Sin Docker)

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Ejecutar en modo desarrollo con recarga automática:
   ```bash
   npm run dev
   ```

3. Ejecutar pruebas:
   ```bash
   npm test
   ```

## Endpoints HTTP Disponibles (RF-8.5)

- `POST /tickets` - Crear un ticket de soporte asociado a un viaje.
- `GET /tickets/:id` - Obtener información de un ticket por ID.
- `PATCH /tickets/:id/estado` - Actualizar estado del ticket (`ABIERTO`, `EN_PROCESO`, `RESUELTO`).
- `GET /tickets` - Listar todos los tickets (pruebas/verificación).
