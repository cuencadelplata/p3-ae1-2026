# M8 - Notificaciones, Documentos y Soporte

Microservicio responsable de la emision, consulta y reenvio del comprobante de viaje en PDF.

Alcance implementado en AE1:

| RF | Titulo | Estado |
| --- | --- | --- |
| RF-8.3 | Comprobante PDF | Implementado |
| RF-8.4 | Reenvio de comprobante | Implementado (entrega simulada) |
| RF-8.1 | Notificaciones de viaje | Fuera de alcance en AE1 |
| RF-8.2 | QR de verificacion | Fuera de alcance en AE1 |
| RF-8.5 | Soporte asociado a viaje | Fuera de alcance en AE1 |
| RF-8.6 | Consumo asincrono (RabbitMQ) | Previsto para AE2 |

## Requisitos

- Node.js 22 o superior
- npm 10 o superior

## Puesta en marcha

```bash
cd m8-documentos
npm install
cp .env.example .env
npm run dev
```

El servicio queda escuchando en `http://localhost:3008`.

### Scripts

| Script | Descripcion |
| --- | --- |
| `npm run dev` | Ejecuta el servicio en modo desarrollo con recarga automatica |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Ejecuta el servicio ya compilado |
| `npm run typecheck` | Verifica tipos sin generar salida |
| `npm run clean` | Elimina el directorio `dist/` |

## Configuracion

Todas las variables se leen del entorno; ninguna clave ni cadena de conexion se
versiona en el repositorio (RNF-11). El detalle completo esta en `.env.example`.

| Variable | Valor por defecto | Descripcion |
| --- | --- | --- |
| `PORT` | `3008` | Puerto HTTP del servicio |
| `API_PREFIX` | `/api/v1` | Prefijo de la API REST |
| `STATIC_PREFIX` | `/files/receipts` | Ruta publica de descarga directa de PDF |
| `PUBLIC_BASE_URL` | `http://localhost:3008` | URL base usada para construir los enlaces |
| `CORS_ORIGIN` | `*` | Origenes permitidos, o lista separada por comas |
| `STORAGE_DIR` | `storage/receipts` | Directorio de persistencia |
| `RECEIPT_ISSUER_NAME` | `Plataforma de Movilidad Urbana` | Encabezado del comprobante |
| `RECEIPT_TIMEZONE` | `America/Argentina/Buenos_Aires` | Zona horaria de las fechas del PDF |
| `RECEIPT_LOCALE` | `es-AR` | Formato de importes y fechas |

## API

Base: `http://localhost:3008/api/v1`

### `POST /receipts`

Emite el comprobante de un viaje finalizado. Es **idempotente por `tripId`**:
responde `201` cuando emite el comprobante y `200` cuando ya existia.

```bash
curl -X POST http://localhost:3008/api/v1/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "tripId": "trip-2026-000123",
    "customer": {
      "id": "cli-0091",
      "fullName": "Lucia Fernandez",
      "email": "lucia.fernandez@example.com",
      "documentId": "38.442.019"
    },
    "driver": {
      "id": "cnd-0457",
      "fullName": "Martin Rodriguez",
      "vehicle": { "type": "AUTO", "plate": "AB123CD", "model": "Toyota Etios 2021" }
    },
    "trip": {
      "origin": "Av. Colon 1250, Cordoba",
      "destination": "Aeropuerto Ambrosio Taravella",
      "startedAt": "2026-08-28T13:05:00.000Z",
      "finishedAt": "2026-08-28T13:36:00.000Z",
      "distanceKm": 14.8,
      "durationMin": 31
    },
    "fare": {
      "currency": "ARS",
      "baseFare": 1200,
      "distanceAmount": 5920,
      "timeAmount": 1550,
      "surcharges": 430,
      "discounts": 600,
      "total": 8500
    },
    "payment": { "method": "TARJETA", "status": "APROBADO", "authorizationCode": "AUTH-77321" }
  }'
```

Reglas de validacion relevantes:

- `tripId`: letras, numeros, guion y guion bajo, hasta 64 caracteres.
- `driver.vehicle.type`: `AUTO` o `MOTO`.
- `payment.method`: `EFECTIVO`, `TARJETA` o `BILLETERA`.
- `payment.status`: `APROBADO`, `PENDIENTE` o `RECHAZADO`.
- `fare.total` es obligatorio. El desglose es opcional, pero si se informa debe
  cerrar con el total (`baseFare + distanceAmount + timeAmount + surcharges - discounts`).

### `GET /receipts/:tripId`

Devuelve los metadatos del comprobante, su historial de entregas y los enlaces
de descarga.

### `GET /receipts/:tripId/pdf`

Descarga controlada del PDF, con `Content-Disposition: attachment`.

### `POST /receipts/:tripId/resend`

Vuelve a solicitar el envio del comprobante (RF-8.4). Sin cuerpo utiliza el
email registrado del cliente; opcionalmente admite `{ "channel": "EMAIL", "destination": "..." }`
con `channel` en `EMAIL`, `SMS` o `PUSH`. Responde `202` y registra la entrega.

En AE1 el envio se simula: se deja constancia en el historial del comprobante y
se devuelve el enlace de descarga. En AE2 este punto pasa a publicar un evento
en RabbitMQ hacia el canal de notificaciones.

### `GET /health`

Estado del servicio y de su almacenamiento. Devuelve `503` cuando el directorio
de persistencia no esta disponible.

### Descarga estatica

Los PDF tambien se publican como archivos estaticos en
`http://localhost:3008/files/receipts/<tripId>.pdf`.

### Formato de error

Todas las respuestas de error comparten la misma estructura (RNF-05):

```json
{
  "error": {
    "code": "RECEIPT_NOT_FOUND",
    "message": "No existe un comprobante emitido para el viaje trip-000",
    "path": "/api/v1/receipts/trip-000",
    "timestamp": "2026-08-28T10:55:36.653Z"
  }
}
```

| Codigo | HTTP | Situacion |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | El cuerpo no cumple el contrato; `details` lista cada campo |
| `INVALID_TRIP_ID` | 400 | El `tripId` de la ruta no respeta el formato admitido |
| `MALFORMED_JSON` | 400 | El cuerpo no es JSON valido |
| `RECEIPT_NOT_FOUND` | 404 | No hay comprobante emitido para ese viaje |
| `ROUTE_NOT_FOUND` | 404 | La ruta solicitada no existe |
| `RECEIPT_PDF_UNAVAILABLE` | 409 | El comprobante existe pero su PDF no esta disponible |
| `DELIVERY_DESTINATION_REQUIRED` | 422 | El reenvio no tiene destino registrado ni informado |
| `INTERNAL_ERROR` | 500 | Error no controlado |

## Ejecucion en contenedor

```bash
cd m8-documentos
docker build -t m8-documentos:1.0.0 .
docker run --rm -p 3008:3008 \
  -e PUBLIC_BASE_URL=http://localhost:3008 \
  -v m8-storage:/app/storage \
  m8-documentos:1.0.0
```

La imagen usa construccion multietapa, corre con el usuario `node` sin
privilegios y expone un `HEALTHCHECK` contra `/health`. El volumen `m8-storage`
conserva los comprobantes emitidos entre ejecuciones.

## Estructura

```
src/
├── index.ts                 arranque del proceso y apagado ordenado
├── app.ts                   construccion de la aplicacion Express
├── config/env.ts            lectura y validacion de variables de entorno
├── models/receipt.ts        contratos de entrada y modelo del comprobante
├── validators/              validacion del cuerpo de las solicitudes
├── controllers/             traduccion HTTP <-> dominio
├── services/
│   ├── receipt.service.ts   emision idempotente, consulta y reenvio
│   └── pdf.service.ts       maquetado del comprobante con pdfkit
├── repositories/            persistencia de metadatos y archivos PDF
├── middlewares/             manejo de errores y rutas inexistentes
├── routes/                  definicion de endpoints
├── errors/                  error de aplicacion con codigo y estado HTTP
└── utils/                   formato, identificadores y candado por clave
```

## Propiedad de datos (RNF-04)

M8 no consulta bases de datos de otros servicios. Recibe por REST los datos del
viaje finalizado (M6) junto con la tarifa y el pago (M7) y persiste su propia
copia del comprobante.

En AE1 la persistencia es transitoria sobre el sistema de archivos, con los
metadatos y los PDF en directorios separados:

```
storage/receipts/
├── metadata/<tripId>.json   datos del comprobante (nunca se publica)
└── pdf/<tripId>.pdf         archivo descargable (publicado como estatico)
```

La separacion es deliberada: solo el directorio `pdf/` se monta como contenido
estatico, de modo que los metadatos con datos personales no quedan accesibles
por URL. En AE2 el repositorio se reemplaza por `CommunicationsDB` mas
almacenamiento de objetos, manteniendo la interfaz actual.

## Concurrencia e idempotencia (RNF-09)

La emision esta protegida en dos niveles para que un mismo viaje no genere dos
comprobantes distintos:

1. Un candado por `tripId` dentro del proceso serializa las solicitudes
   concurrentes; la segunda encuentra el comprobante ya emitido y lo devuelve.
2. El metadato se escribe con el flag `wx` (creacion exclusiva). Si dos
   instancias del servicio compiten, solo una gana; la otra relee el
   comprobante existente y responde con el mismo documento.

El PDF se escribe primero en un archivo temporal y se renombra recien despues de
que el metadato quedo confirmado, para que nunca exista un PDF sin comprobante
asociado.

Verificacion: ocho solicitudes simultaneas de emision sobre el mismo `tripId`
devuelven un unico `201` y siete `200`, todas con el mismo `receiptId`.

## Decisiones tecnicas

- **Express 5 + TypeScript**: contratos REST explicitos y tipado del dominio
  compartido entre modulos.
- **pdfkit**: generacion del PDF en memoria, sin binarios externos ni fuentes
  adicionales, lo que mantiene liviana la imagen del contenedor.
- **tsx en desarrollo**: `ts-node-dev` no es compatible con TypeScript 7, que ya
  no expone la API de compilador que esa herramienta necesita.
- **Sin pasarela de pago real**: el comprobante es de demostracion y lo declara
  en su pie, segun el alcance S2-AE1.6 del escenario.
