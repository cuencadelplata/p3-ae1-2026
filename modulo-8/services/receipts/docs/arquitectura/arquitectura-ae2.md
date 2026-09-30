# Arquitectura del servicio de comprobantes (AE2)

Versión 2.0.0 del servicio `m8-documentos`. La arquitectura de AE1 se conserva como
evidencia en [componentes-m8.md](componentes-m8.md).

## 1. Componentes

```mermaid
flowchart LR
    M7["M7 - Pagos"]
    RD["Receipts Delivery (RF-8.4)"]
    SUB["Suscriptores de receipt.issued"]
    CLI["Cliente / API Gateway"]

    subgraph MQ["RabbitMQ"]
        EX(["mobility.events (topic)"])
        Q["m8.receipts.payment-confirmed"]
        RQ["...retry"]
        DLQ["...dlq"]
    end

    subgraph SVC["m8-documentos 2.0.0"]
        HTTP["API REST<br/>/api/v1/receipts"]
        INT["API interna<br/>/internal/receipts"]
        CONS["Consumidor<br/>payment.confirmed"]
        EMI["Emisión<br/>receipt.service"]
        PDF["Generador PDF<br/>PDFKit"]
        LINK["Enlaces temporales"]
        RELAY["Relay de la<br/>bandeja de salida"]
        HEALTH["/health/live<br/>/health/ready"]
    end

    PG[("PostgreSQL<br/>esquema receipts")]
    RED[("Redis<br/>m8:receipts:link:*")]

    M7 -- publica --> EX
    EX -- payment.confirmed --> Q
    Q --> CONS
    CONS -. fallo transitorio .-> RQ
    RQ -. vence la espera .-> Q
    CONS -. inválido o reintentos agotados .-> DLQ

    CLI --> HTTP
    RD --> INT
    HTTP --> EMI
    CONS --> EMI
    EMI --> PDF
    EMI -- comprobante + PDF + evento<br/>en una transacción --> PG
    INT --> LINK
    HTTP --> LINK
    LINK --> RED
    RELAY -- lee pendientes --> PG
    RELAY -- receipt.issued --> EX
    EX --> SUB
    HEALTH -.-> PG & RED & MQ
```

| Componente | Responsabilidad |
| --- | --- |
| API REST | Emisión manual, consulta, descarga y reenvío. Contrato: `openapi/receipts.openapi.yaml`. |
| API interna | `delivery-reference` para Receipts Delivery. Contrato: catálogo de eventos, sección 6. |
| Consumidor | ACK manual, reintentos con cola de espera, DLQ y bandeja de entrada. |
| Emisión | Única lógica de emisión para ambos caminos; idempotente por `tripId`. |
| Relay | Publica la bandeja de salida con confirmación de RabbitMQ; `SKIP LOCKED` entre réplicas. |
| Enlaces temporales | Token opaco con TTL en Redis. |
| Health | Vitalidad sin dependencias; disponibilidad por dependencia (PostgreSQL crítica). |

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
| Pago confirmado | M7 | Evento `payment.confirmed` |
| Cliente, conductor, recorrido | M1 / M6 | Llegan en el evento (provisorio, pendiente de M7); se guardan como foto inmutable |
| Enlaces de descarga | Este servicio (Redis, efímero) | Propio; vencen solos |

Ningún otro servicio accede a estas tablas, y este servicio no accede a tablas ajenas.
Fundamento en [ADR-004](../adr/ADR-004-persistencia-ae2.md).

## 3. Secuencia: emisión asincrónica y publicación de `receipt.issued`

```mermaid
sequenceDiagram
    autonumber
    participant M7 as M7 - Pagos
    participant MQ as RabbitMQ
    participant C as Consumidor
    participant S as Emisión
    participant DB as PostgreSQL
    participant R as Relay

    M7->>MQ: payment.confirmed (messageId, correlationId = tripId)
    MQ->>C: entrega (al menos una vez)
    C->>DB: ¿messageId en processed_messages?
    alt ya procesado
        C->>MQ: ACK (reentrega descartada)
    else nuevo
        C->>S: issueReceipt(pedido)
        S->>DB: ¿comprobante del tripId?
        S->>S: genera el PDF
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

Si la base no responde, el consumidor republica el mensaje en la cola `.retry` (espera
de 5 s, hasta 3 veces) y después lo envía a la DLQ. Un mensaje inválido va directo a la
DLQ. Si RabbitMQ no responde, el evento queda pendiente en `outbox_events`.

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
