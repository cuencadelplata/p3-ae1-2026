# Arquitectura de M9

```text
Cliente REST
    |
    v
routes -> controllers -> schemas
              |
              v
           services -----------------> clients -> M7 / M5
              |
              v
         repository interface
              |
              v
      Supabase repository -> Supabase Cloud

node-cron -> scheduler -> activation service -> repository + M5 client
```

## Responsabilidades

- `routes`: registra recursos y verbos HTTP.
- `controllers`: adapta request/response y dispara validación.
- `schemas`: valida DTOs estrictos; los estados no forman parte de los DTOs de cliente.
- `services`: aplica invariantes y coordina M7, persistencia y M5.
- `repositories`: define el puerto de persistencia y su implementación Supabase.
- `domain`: representa reservas y mapea `snake_case` de base a `camelCase` de API.
- `clients`: encapsula contratos HTTP, timeout y validación de respuestas externas.
- `jobs`: consulta vencimientos persistidos e invoca el caso de uso de activación.
- `config`: valida entorno y crea el cliente Supabase tipado.

Controllers, jobs y clients no acceden directamente a tablas. El servicio depende de interfaces, lo que permite pruebas deterministas sin sustituir la persistencia productiva.

## Máquina de estados

```text
                    +--------------+
                    |  PROGRAMADA  |
                    +------+-------+
                           |
             +-------------+-------------+
             |                           |
          cancelar                     reclamar
             |                           |
             v                           v
       +-----------+               +------------+
       | CANCELADA |               | ACTIVANDO  |
       +-----------+               +------+-----+
                                          |
                                  +-------+-------+
                                  |               |
                                M5 OK          M5 falla
                                  |               |
                                  v               v
                            +----------+      +---------+
                            | ACTIVADA |      | FALLIDA |
                            +----------+      +---------+
```

Solo `PROGRAMADA` admite PATCH o cancelación. Los estados son controlados por M9.

## Activación concurrente

1. El scheduler consulta en Supabase reservas vencidas en `PROGRAMADA`.
2. Para cada ID intenta un solo `UPDATE` con filtros `id = ?` y `estado = PROGRAMADA`.
3. El worker que obtiene una fila es dueño del reclamo y llama a M5.
4. Con respuesta M5, cambia `ACTIVANDO → ACTIVADA` y guarda `id_solicitud`.
5. Ante error M5, cambia `ACTIVANDO → FALLIDA`.

Leer antes de actualizar no decide el ganador. La condición del mismo `UPDATE` es la garantía atómica; por eso no fue necesaria una RPC ni una migración.

## Dependencias externas

- M7 participa solamente al crear. Su indisponibilidad no cancela la reserva.
- M5 participa después del reclamo. Su indisponibilidad produce `FALLIDA`.
- Supabase es la única persistencia y fuente de verdad del scheduler.

## Despliegue

La misma imagen compila M9 y ambos stubs. Docker Compose cambia el comando de los servicios stub y los conecta mediante `reservas-network`; solo M9 se publica al host. Supabase permanece externo.
