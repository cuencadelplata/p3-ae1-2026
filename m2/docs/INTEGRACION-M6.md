# RF-2.2 reutiliza la integración de RF-2.4

La llamada se realiza mediante el mismo `modulo6Client.obtenerViajePorId(viajeId)` de calificaciones. Se conservan `M6_BASE_URL`, GET `/api/viajes/{viajeId}`, el fallback heredado `/api/v1/trips/{viajeId}`, el timeout y el circuit breaker. RF-2.2 tiene su propia persistencia y lógica; no requiere crear una calificación ni consulta tablas de M6.

## Flujo

1. La aplicación conoce el ID de un viaje completado y llama a M2: `POST /api/v1/direcciones/desde-viaje` con `{ "viajeId": "ID_REAL" }` y Bearer.
2. M2 consulta M6, verifica identidad, propietario y estado COMPLETADO (también acepta minúsculas).
3. Convierte `origen`/`destino` textuales en direcciones locales, sin inventar coordenadas ni consultar mapas.
4. Guarda las dos direcciones y su relación A → B en una transacción. `viajeId` evita duplicar usos aunque se reintente o llegue por RabbitMQ.
5. La aplicación consulta `GET /api/v1/direcciones/sugerencias`. M2 ofrece B como origen y A como destino para volver, más otras direcciones propias. El cliente puede cambiar ambas.

Ejemplo de respuesta de M6 compatible con los campos del archivo recibido:

```json
{
  "id": "3f0c9c1e-6a51-4d0e-9b57-0c2d1a7f4b11",
  "clienteId": "cliente-123",
  "conductorId": "conductor-001",
  "estado": "COMPLETADO",
  "origen": "Calle Principal 100",
  "destino": "Centro Comercial",
  "fechaCreacion": "2026-10-05T14:00:00Z"
}
```

`conductorId` lo utiliza RF-2.4; RF-2.2 necesita id, clienteId, estado, origen y destino. `fechaCreacion` sirve como referencia de orden, no se presenta como fecha de finalización. Si existe `completadoAt`, se prefiere; si no hay ninguna fecha, se usa la primera importación. La respuesta expone `fechaReferencia` = FINALIZACION, CREACION o IMPORTACION. Sin fecha de finalización no se puede asegurar el orden exacto de finalización de todos los viajes.

## Sugerencias

La respuesta de `/api/v1/direcciones/sugerencias` incluye:

- `origenes`: candidatos propios; B primero cuando existe sugerencia de regreso.
- `destinos`: candidatos propios; A primero para ese regreso.
- `regreso`: par invertido del último viaje completado importado conocido, o null.
- Dentro de regreso: `requiereConfirmacion: true`. No se afirma que el pasajero siga en B ni se inicia un viaje automáticamente.

El tipo ORIGEN/DESTINO en una dirección describe su uso guardado, pero no impide seleccionarla para el otro extremo. Las listas no exponen datos de otro cliente. Si no hay información se devuelven listas vacías. Eliminar una dirección elimina también las parejas guardadas que la contengan, para que no reaparezca en regreso.

Los viajes ya procesados antes de la migración 2.2 conservan sus recientes, pero no se inventa una pareja a partir de filas sueltas; las parejas se guardan para las nuevas importaciones/eventos de esta versión. Se retienen hasta 20 parejas y 20 direcciones no favoritas. Una dirección textual y otra geocodificada no se fusionan automáticamente sólo por compartir nombre: podría tratarse de lugares distintos.

## Conectar al servidor de los compañeros

Si M2 se ejecuta directamente con Node, configurar su misma variable heredada `M6_BASE_URL` en `.env` y reiniciar. Es la configuración compartida por RF-2.2 y RF-2.4.

Si M2 corre en Docker, usar el archivo `docker-compose.m6-real.yml`. Configurar en `.env`:

```dotenv
# Ejemplo únicamente: sustituir por la ubicación real de M6.
M6_REAL_BASE_URL=http://host.docker.internal:3000
API_PORT=3002
```

`host.docker.internal` identifica el host desde Docker; `localhost` dentro de M2 identificaría su propio contenedor. Si M6 vive en otra computadora, usar su IP/nombre en la LAN y puerto reales. El ejemplo cambia M2 a 3002 para no ocupar el 3000 que el contrato de M6 propone.

Detener primero el Compose de demostración sin borrar volúmenes y levantar el perfil real:

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.m6-real.yml up --build -d
```

Ese archivo no inicia el simulador M6. No sustituye silenciosamente al servidor real si está caído. Los demás simuladores siguen siendo de demostración; la conexión REST de M6 es la que apunta al servidor configurado.

## Qué se sabe del contrato aportado

Se conservó el texto recibido en `referencias/m6-recibido.txt`. Declara `origen` y `destino` como strings y los estados en mayúsculas. Tiene problemas de indentación en campos QR y no documenta GET `/api/viajes/{id}`; sí documenta POST para crear viajes y transiciones. No se convierte ese POST en consulta ni se crean viajes para leerlos.

El GET se reutiliza porque ya está en el código de RF-2.4, según la conexión indicada por el usuario. Las pruebas verifican el adaptador contra una respuesta HTTP local con la forma de ViajeResponse. **No se recibió una URL real accesible ni una respuesta capturada de ese GET**, así que no se afirma haber validado el servidor de los compañeros. Si la ruta real difiere o no devuelve esas direcciones, ajustar el cliente compartido con su contrato efectivo.

Los eventos del M6 real se documentan en otro archivo (`AE2-M6-documentacion.md`), no recibido. `TripCompleted.v1` sigue siendo contrato de demostración, no un nombre atribuido al M6 real. La integración RF-2.2 solicitada puede utilizar REST sin depender de ese acuerdo de eventos.

## Sin Internet

Favoritos y sugerencias guardadas se consultan en M2 sin llamar a M6. Si M6 está en la misma computadora/LAN, también funciona la importación sin Internet. Si M6 resulta inaccesible, importar devuelve 503 y no inventa datos; los recientes ya guardados siguen disponibles. Para importar viajes nuevos de un M6 alojado sólo en Internet hay que esperar la reconexión. Ver SIN-INTERNET.md para preparar imágenes y probar una red sin salida pública.
