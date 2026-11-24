# Verificación de reconexión de RabbitMQ

Verificación realizada el 24 de noviembre de 2026 sobre main 953c5f65 con la
corrección de reconexión de M4. Se levantaron M4, Redis, PostgreSQL y RabbitMQ
desde el Compose general, con proyecto, red y puertos propios de prueba.

La red externa del stack se reemplazó para esta ejecución por una red de prueba.
La publicación de ubicación usó SKIP_AUTH_VALIDATION=true para comprobar la
disponibilidad después de recuperar el consumidor. La autenticación de M1
corresponde al escenario E2E separado.

## Escenario y resultados

1. Se construyó M4 y se esperó a que sus dependencias estuvieran saludables.
2. Se detuvo y eliminó el contenedor RabbitMQ del proyecto de prueba.
3. M4 respondió 503 en readiness. Liveness y búsqueda nearby siguieron respondiendo 200.
4. Los logs reprodujeron getaddrinfo ENOTFOUND rabbitmq.
5. Se recreó RabbitMQ. Readiness volvió a 200 sin reiniciar ni recrear M4.
6. Se publicó la ubicación disponible del conductor de prueba.
7. Se publicó viaje.iniciado en trip.events con un eventId nuevo.
8. M4 consumió el evento y el conductor dejó de aparecer como disponible en nearby.

Todos los pasos se completaron correctamente. El contenedor M4 conservó su ID
durante la caída y recuperación del broker.

La corrección recupera conexiones y suscripciones después de fallos transitorios.
Una configuración permanente de red incorrecta requiere corregir el Compose o
la conexión del contenedor a la red.
