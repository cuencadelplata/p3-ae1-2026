# M4 UI - Panel de demostracion

Interfaz grafica independiente para probar el servicio de Ubicacion y Disponibilidad. Se publica en un contenedor Nginx separado y consume la API de M4 mediante HTTP.

La forma recomendada de ejecutar UI y API juntas es usar `docker compose` desde la carpeta `modulo-4`.

Para publicar o consultar una ubicacion se debe ingresar un token JWT de un usuario con rol `CONDUCTOR`, emitido y validado por M1. El `driverId` utilizado por M4 es el mismo `userId` numerico de M1.
