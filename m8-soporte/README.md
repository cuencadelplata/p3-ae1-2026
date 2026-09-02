# Módulo 8: Notificaciones, Documentos y Soporte (m8-soporte)

Microservicio encargado de la gestión de tickets de soporte, notificaciones y consumo asíncrono de eventos mediante RabbitMQ para la plataforma distribuida de movilidad urbana.

---

## 🐋 Imagen Docker Pública (Registry pública)

En cumplimiento con los requerimientos de la consigna de evaluación:

- **Registry / Repositorio:** Docker Hub
- **Nombre de la Imagen:** `damnia/m8-soporte`
- **Etiqueta de Versión:** `1.3`
- **Enlace Público:** [https://hub.docker.com/r/damnia/m8-soporte](https://hub.docker.com/r/damnia/m8-soporte)

### Comando para descargar la imagen pública:
```bash
docker pull damnia/m8-soporte:1.3
```

---

## 🚀 Requisitos Previos

- [Docker](https://www.docker.com/) y Docker Compose v2+ instalados.
- [Node.js](https://nodejs.org/) v20+ / v22+ (para desarrollo local opcional sin contenedores).

---

## ⚡ Ejecución Orquestada con Docker Compose

Para levantar el microservicio `m8-soporte` y el contenedor de `rabbitmq` de forma conjunta, aislada y reproducible:

```bash
# Iniciar servicios en segundo plano
docker compose up --build -d
```

### Puertos y Servicios Expuestos

- **Estado del Servicio / API Raíz:** [http://localhost:3000](http://localhost:3000)
- **Documentación Interactiva OpenAPI (Swagger UI):** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
- **Panel de Administración RabbitMQ (Management):** [http://localhost:15672](http://localhost:15672)  
  *(Credenciales por defecto: Usuario: `guest` | Contraseña: `guest`)*
- **Broker RabbitMQ (Puerto AMQP):** `amqp://localhost:5672`

### Detener los Contenedores

```bash
docker compose down
```

---

## 🧪 Ejecución de Pruebas Unitarias e Integración (Vitest)

Para ejecutar la suite de pruebas unitarias y de integración contra los controladores y modelos del microservicio:

```bash
# Navegar a la carpeta del servicio
cd m8-soporte

# Instalación de dependencias locales
npm install

# Ejecución de pruebas con Vitest
npm test
```

---

## 📌 Requerimientos Funcionales Implementados

### 🟢 RF-8.5: Gestión de Tickets de Soporte
- `GET /` - Estado del servicio y mapa de endpoints.
- `POST /tickets` - Crear un nuevo ticket de soporte asociado a un viaje (`viajeId`, `motivo`).
- `GET /tickets/:id` - Consultar información de un ticket específico por su ID.
- `PATCH /tickets/:id/estado` - Actualizar el estado de un ticket (`ABIERTO`, `EN_PROCESO`, `RESUELTO`).
- `GET /tickets` - Listar todos los tickets almacenados en el repositorio.

### 🟣 RF-8.6: Consumo Asíncrono mediante RabbitMQ
Consumo de eventos provenientes del broker en el intercambio `viajes_exchange` y la cola `m8_async_events`:
- **`viaje.asignado`:** Envío de notificación PUSH simulada al cliente.
- **`viaje.iniciado`:** Generación de código QR temporal de validación.
- **`viaje.completado`:** Generación de comprobante PDF y notificación por Email al cliente.
