# Arquitectura del servicio de comprobantes (AE2)

Versión 2.3.0 del servicio `m8-documentos`. La arquitectura de AE1 se conserva como
evidencia en [componentes-m8.md](componentes-m8.md).

Desde la 2.2.0, M7 se integra por REST: no publica `payment.confirmed` y el servicio
le consulta el pago antes de emitir. La entrada por evento se conserva con un
productor simulado (catálogo de eventos, sección 5.1).

## 1. Componentes

```mermaid
flowchart LR
    PROD["Productor de payment.confirmed<br/>(simulado en AE2)"]
    RD["Receipts Delivery (RF-8.4)"]
    SUB["Suscriptores de receipt.issued"]
    CLI["Cliente / API Gateway"]

    subgraph MQ["RabbitMQ"]
        EX(["mobility.events (topic)"])
        Q["m8.receipts.payment-confirmed"]
        RQ["...retry"]
        DLQ["...dlq"]
    end

    subgraph SVC["m8-documentos 2.3.0"]
        HTTP["API REST<br/>/api/v1/receipts"]
        INT["API interna<br/>/internal/receipts"]
        CONS["Consumidor<br/>payment.confirmed"]
        EMI["Emisión<br/>receipt.service"]
        PDF["Generador PDF<br/>PDFKit"]
        LINK["Enlaces temporales"]
        RELAY["Relay de la<br/>bandeja de salida"]
        PAY["Cliente M7<br/>timeout"]
        FISC["Cliente fiscal<br/>timeout + circuit breaker"]
        HEALTH["/health/live<br/>/health/ready"]
    end

    AUT["Autorizador fiscal<br/>(externo, simulado)"]
    M7["M7 - Pagos<br/>(simulado: m7-payments-sandbox)"]

    PG[("PostgreSQL<br/>esquema receipts")]
    RED[("Redis<br/>m8:receipts:link:*")]

    PROD -- publica --> EX
    EX -- payment.confirmed --> Q
    Q --> CONS
    CONS -. fallo transitorio o<br/>dependencia caída .-> RQ
    RQ -. vence la espera .-> Q
    CONS -. inválido o reintentos agotados .-> DLQ

    CLI --> HTTP
    RD --> INT
    HTTP --> EMI
    CONS --> EMI
    EMI --> PAY
    PAY -->|"GET /metodo-pago/{viajeId}"| M7
    EMI --> FISC
    FISC -- POST /v1/authorizations<br/>Idempotency-Key = tripId --> AUT
    EMI --> PDF
    EMI -- comprobante + PDF + evento<br/>en una transacción --> PG
    INT --> LINK
    HTTP --> LINK
    LINK --> RED
    RELAY -- lee pendientes --> PG
    RELAY -- receipt.issued --> EX
    EX --> SUB
    HEALTH -.-> PG & RED & MQ & AUT & M7
```

| Componente | Responsabilidad |
| --- | --- |
| API REST | Emisión manual, consulta, descarga y reenvío. Contrato: `openapi/receipts.openapi.yaml`. |
| API interna | `delivery-reference` para Receipts Delivery. Contrato: catálogo de eventos, sección 6. |
| Consumidor | ACK manual, reintentos con cola de espera, DLQ y bandeja de entrada. |
| Emisión | Única lógica de emisión para ambos caminos; idempotente por `tripId`. Verifica el pago en M7 y pide la autorización fiscal antes de generar el PDF. |
| Cliente M7 | Consulta `GET /metodo-pago/{viajeId}` con timeout de 2 s y traduce estado, medio de pago e importe al modelo interno. Solo un pago autorizado habilita la emisión. |
| Cliente fiscal | Llamada al autorizador externo con timeout de 2 s y circuit breaker ([ADR-005](../adr/ADR-005-resiliencia-ae2.md)). |
| Relay | Publica la bandeja de salida con confirmación de RabbitMQ; `SKIP LOCKED` entre réplicas. |
| Enlaces temporales | Token opaco con TTL en Redis. |
| Health | Vitalidad sin dependencias; disponibilidad por dependencia (PostgreSQL crítica; Redis, RabbitMQ, fiscal y M7 no críticas) y estado del circuito. |

## 2. Propiedad de datos

```mermaid
erDiagram
    RECEIPTS ||--|| RECEIPT_DOCUMENTS : "tiene un PDF"
    RECEIPTS ||--o{ RECEIPT_DELIVERIES : "registra reenvíos"
    RECEIPTS {
        uuid receipt_id PK
        text receipt_number UK
        text trip_id UK "árbitro de concurrencia"
        timestamptz issued_at
        jsonb customer "foto recibida, no propia"
        jsonb driver "foto recibida, no propia"
        jsonb trip "foto recibida, no propia"
        jsonb fare
        jsonb payment
        jsonb fiscal "autorización externa"
    }
    RECEIPT_DOCUMENTS {
        uuid pdf_key PK "no deriva del tripId"
        uuid receipt_id FK
        bytea content
    }
    RECEIPT_DELIVERIES {
        bigint delivery_id PK
        uuid receipt_id FK
        text channel
        timestamptz sent_at
    }
    PROCESSED_MESSAGES {
        uuid message_id PK "bandeja de entrada"
        text event_type
        text correlation_id
    }
    OUTBOX_EVENTS {
        uuid message_id PK "bandeja de salida"
        text routing_key
        jsonb envelope
        timestamptz published_at "null = pendiente"
    }
```

| Dato | Dueño | Cómo lo obtiene el servicio |
| --- | --- | --- |
| Comprobante, PDF, reenvíos, bandejas | **Este servicio** (esquema `receipts`, rol `m8_receipts`) | Propio |
| Estado del pago, medio de pago e importe cobrado | M7 | Consulta REST `GET /metodo-pago/{viajeId}` al emitir; se guardan con el comprobante |
| Cliente, conductor, recorrido y desglose de la tarifa | M1 / M6 / M7 | Llegan en el pedido o en el evento (provisorio hasta cerrar los contratos con M1, M2, M3 y M6); se guardan como foto inmutable |
| Enlaces de descarga | Este servicio (Redis, efímero) | Propio; vencen solos |
| Autorización fiscal | Autorizador fiscal (externo) | Llamada HTTP al emitir; se guarda con el comprobante. Solo se le envían identificadores e importes |

Ningún otro servicio accede a estas tablas, y este servicio no accede a tablas ajenas.
Fundamento en [ADR-004](../adr/ADR-004-persistencia-ae2.md).

## 3. Secuencia: emisión asincrónica y publicación de `receipt.issued`

```mermaid
sequenceDiagram
    autonumber
    participant P as Productor (simulado)
    participant MQ as RabbitMQ
    participant C as Consumidor
    participant S as Emisión
    participant M7 as M7 - Pagos
    participant DB as PostgreSQL
    participant R as Relay

    P->>MQ: payment.confirmed (messageId, correlationId = tripId)
    MQ->>C: entrega (al menos una vez)
    C->>DB: ¿messageId en processed_messages?
    alt ya procesado
        C->>MQ: ACK (reentrega descartada)
    else nuevo
        C->>S: issueReceipt(pedido)
        S->>DB: ¿comprobante del tripId?
        S->>M7: GET /metodo-pago/{tripId}
        M7-->>S: estado, tipo, total, moneda
        Note over S,M7: solo sigue con "autorizado"
        S->>S: autorización fiscal (timeout 2 s, circuit breaker)
        S->>S: genera el PDF con el código de autorización
        S->>DB: BEGIN · INSERT comprobante · INSERT PDF · INSERT outbox · COMMIT
        alt UNIQUE(trip_id) violada (otro pedido ganó)
            DB-->>S: 23505
            S->>DB: relee el comprobante ganador
        end
        C->>DB: INSERT processed_messages
        C->>MQ: ACK
    end
    loop cada 1 s
        R->>DB: SELECT pendientes FOR UPDATE SKIP LOCKED
        R->>MQ: publica receipt.issued y espera confirmación
        R->>DB: marca published_at · COMMIT
    end
```

Si la base, M7 o el autorizador fiscal no responden, el consumidor republica el mensaje
en la cola `.retry` (espera de 5 s) **sin descontar intentos**, hasta que la dependencia
vuelva. Un pago pendiente o sin registrar en M7, u otro error inesperado, se reintenta
hasta 3 veces y después va a la DLQ. Un mensaje inválido, un pago rechazado por M7 o un
comprobante rechazado por el autorizador va directo a la DLQ. Si RabbitMQ no
responde, el evento queda pendiente en `outbox_events`. Detalle en
[ADR-005](../adr/ADR-005-resiliencia-ae2.md).

## 4. Secuencia: enlace temporal de descarga

```mermaid
sequenceDiagram
    autonumber
    participant RD as Receipts Delivery
    participant API as m8-documentos
    participant DB as PostgreSQL
    participant RE as Redis
    participant U as Cliente final

    RD->>API: GET /internal/receipts/{tripId}/delivery-reference
    API->>DB: comprobante y existencia del PDF
    API->>RE: SET m8:receipts:link:<token> tripId EX 900
    API-->>RD: 200 { url, expiresAt }
    RD->>U: envía el enlace (email, SMS, push)
    U->>API: GET /api/v1/receipts/downloads/<token>
    API->>RE: GET m8:receipts:link:<token>
    alt vigente
        API->>DB: PDF del tripId
        API-->>U: 200 application/pdf
    else vencido o inexistente
        API-->>U: 410 DOWNLOAD_LINK_EXPIRED
    end
```

## 5. Observabilidad

Cada línea de log es un JSON con `timestamp`, `level`, `service`, `component`,
`message` y `correlationId`. El `correlationId` llega por el encabezado
`X-Correlation-Id` (o se genera) en HTTP, y por el sobre del mensaje en RabbitMQ, de
modo que un viaje se sigue de punta a punta filtrando por su `tripId`:

```bash
docker compose logs receipts --no-log-prefix | grep '"correlationId":"trip-2026-000123"'
```

Los logs no incluyen nombres, emails, destinos de envío ni tokens de descarga.
