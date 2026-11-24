workspace "Módulo 2 - Clientes" "Modelo C4 del módulo M2 (perfil, viajes, estado de cuenta, direcciones frecuentes, calificación)." {

    !identifiers hierarchical

    model {
        cliente = person "Cliente" "Usuario de la plataforma de viajes."

        m2 = softwareSystem "M2 Clientes" "Gestiona perfil, historial de viajes, estado de cuenta, direcciones frecuentes y calificación del conductor." {
            client = container "Client" "Interfaz web del cliente." "React + Vite, nginx" "Web Browser"
            api = container "API" "API REST de M2. Valida identidad, aplica reglas de negocio y escribe outbox." "Node.js, Express, TypeScript, Prisma" {
                routes = component "Routes y Controllers" "customer, trips, account-status, calificacion, direcciones." "Express"
                middlewares = component "Middlewares" "Autenticación (token HMAC / M1), validación y manejo de errores." "Express"
                services = component "Services" "Reglas de negocio: perfil, viajes, estado de cuenta, calificación, direcciones." "TypeScript"
                repositories = component "Repositories" "Acceso a CustomerDB mediante Prisma; transacciones SERIALIZABLE con reintentos." "Prisma"
                cache = component "Customer Cache" "Cache de listas con clave versionada por revisión durable y TTL." "ioredis"
                clients = component "Integration Clients" "Clientes HTTP de M1, M4, M6 y Soporte con timeout, reintentos y circuit breaker." "HTTP, resilience policies"
                health = component "Health y Observabilidad" "Endpoints live/ready, logs JSON y métricas." "TypeScript"
            }
            worker = container "Worker" "Consume TripCompleted.v1 (inbox) y publica el outbox como FavoriteAddressChanged.v1." "Node.js, amqplib" {
                consumer = component "Consumer" "Consume con ack manual, retry por TTL y DLQ; deduplica por eventId y viajeId." "amqplib"
                publisher = component "Outbox Publisher" "Publica con confirms y marca publicadoAt." "amqplib"
            }
            db = container "CustomerDB" "Perfiles, direcciones, viajes recientes, calificaciones, inbox, outbox e idempotencia." "PostgreSQL 16" "Database"
            redis = container "Redis" "Cache efímera de listas; PostgreSQL conserva la verdad." "Redis 7" "Database"
        }

        m1 = softwareSystem "M1 Autenticación y Perfil" "Identidad y datos personales del cliente." "External"
        m4 = softwareSystem "M4 Mapas" "Geocodificación de direcciones (simulado en esta entrega)." "External"
        m6 = softwareSystem "M6 Viajes" "Propietario de los viajes; emite TripCompleted.v1 (simulado)." "External"
        m8 = softwareSystem "M8 Notificaciones" "Entrega de notificaciones al cliente (bandeja simulada)." "External"
        soporte = softwareSystem "Soporte" "Penalizaciones y estado de cuenta de soporte." "External"
        rabbit = softwareSystem "RabbitMQ" "Broker de mensajería, colas durables con retry y DLQ." "Infrastructure"

        # Contexto
        cliente -> m2 "Gestiona su perfil, viajes y direcciones"
        m2 -> m1 "Valida identidad y obtiene datos personales" "HTTP"
        m2 -> m4 "Geocodifica direcciones" "HTTP, 2 s"
        m2 -> m6 "Consulta viajes del cliente" "HTTP"
        m2 -> soporte "Consulta penalizaciones" "HTTP"
        m6 -> rabbit "Publica TripCompleted.v1" "AMQP"
        rabbit -> m2 "Entrega TripCompleted.v1" "AMQP"
        m2 -> rabbit "Publica FavoriteAddressChanged.v1" "AMQP"
        rabbit -> m8 "Entrega FavoriteAddressChanged.v1" "AMQP"
        m8 -> cliente "Notifica cambios de direcciones favoritas"

        # Contenedores
        cliente -> m2.client "Usa" "HTTPS"
        m2.client -> m2.api "Llama" "REST/JSON"
        m2.api -> m2.db "Lee y escribe" "Prisma/SQL"
        m2.api -> m2.redis "Cachea listas" "Redis protocol"
        m2.api -> m1 "Valida identidad y perfil" "HTTP"
        m2.api -> m4 "Geocodifica" "HTTP, 2 s"
        m2.api -> m6 "Consulta viajes" "HTTP"
        m2.api -> soporte "Consulta penalizaciones" "HTTP"
        m2.worker -> m2.db "Inbox, viajes recientes y outbox" "Prisma/SQL"
        m2.worker -> rabbit "Consume TripCompleted.v1 y publica FavoriteAddressChanged.v1" "AMQP"

        # Componentes de la API
        m2.api.routes -> m2.api.middlewares "Usa"
        m2.api.routes -> m2.api.services "Delega"
        m2.api.services -> m2.api.repositories "Persiste con"
        m2.api.services -> m2.api.cache "Cachea con"
        m2.api.services -> m2.api.clients "Integra con"
        m2.api.repositories -> m2.db "Lee y escribe" "Prisma/SQL"
        m2.api.cache -> m2.redis "Lee y escribe" "Redis protocol"
        m2.api.clients -> m1 "HTTP"
        m2.api.clients -> m4 "HTTP"
        m2.api.clients -> m6 "HTTP"
        m2.api.clients -> soporte "HTTP"
        m2.api.health -> m2.db "Verifica" "SQL"
        m2.api.health -> m2.redis "Verifica"

        # Componentes del worker
        m2.worker.consumer -> rabbit "Consume TripCompleted.v1" "AMQP, ack manual"
        m2.worker.consumer -> m2.db "Inbox + ViajeProcesado + recientes" "Prisma/SQL"
        m2.worker.publisher -> m2.db "Lee outbox pendiente" "Prisma/SQL"
        m2.worker.publisher -> rabbit "Publica FavoriteAddressChanged.v1" "AMQP, confirms"
    }

    views {
        systemContext m2 "C1-Contexto" {
            include *
            autolayout lr
        }

        container m2 "C2-Contenedores" {
            include *
            autolayout lr
        }

        component m2.api "C3-Componentes-API" {
            include *
            autolayout lr
        }

        component m2.worker "C3-Componentes-Worker" {
            include *
            autolayout lr
        }

        styles {
            element "Person" {
                shape Person
                background #08427b
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "External" {
                background #999999
                color #ffffff
            }
            element "Infrastructure" {
                background #6b4c9a
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
            element "Database" {
                shape Cylinder
            }
            element "Web Browser" {
                shape WebBrowser
            }
        }
    }
}
