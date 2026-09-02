# Funcionamiento de M9 – Reservas Programadas

## Responsabilidad del módulo

M9 administra reservas de viajes para una fecha futura. Expone una API REST y una interfaz web, consulta a M7 para estimar la tarifa y, cuando llega el horario programado, solicita a M5 la creación del viaje.

## Componentes

- `src/server.ts` compone las dependencias e inicia HTTP y el scheduler.
- `src/routes` y `src/controllers` reciben las operaciones HTTP.
- `src/schemas` valida entradas con Zod.
- `src/services/reserva.service.ts` contiene las reglas del CRUD.
- `src/services/activacion-reserva.service.ts` coordina la activación con M5.
- `src/jobs/reservas.scheduler.ts` busca reservas vencidas periódicamente.
- `src/repositories/reserva.repository.ts` define el contrato de persistencia.
- `src/repositories/in-memory-reserva.repository.ts` implementa ese contrato temporalmente en memoria.
- `src/clients` encapsula las llamadas HTTP a M5 y M7.

## Flujo de creación

1. El consumidor envía `POST /reservas`.
2. El controlador valida cuerpo, UUID, vehículo, ubicaciones y fecha futura.
3. El servicio consulta a M7 para obtener tarifa y moneda.
4. Si M7 falla, la reserva igualmente puede crearse con tarifa nula.
5. El repositorio genera el UUID y almacena la reserva como `PROGRAMADA`.
6. La API responde `201` con la representación creada.

## Consulta, modificación y cancelación

Las reservas se listan por fecha programada ascendente. Una reserva solo puede modificarse o cancelarse cuando está `PROGRAMADA`. La cancelación es lógica: cambia el estado a `CANCELADA` y conserva el objeto durante la ejecución.

Los objetos devueltos por el repositorio son copias. De este modo, ningún controlador o servicio puede modificar accidentalmente el estado interno sin utilizar una operación del contrato.

## Activación programada

El scheduler ejecuta el siguiente flujo:

1. busca reservas `PROGRAMADA` cuya fecha ya llegó;
2. intenta cambiar cada una a `ACTIVANDO` indicando el estado esperado;
3. solo el primer intento que encuentra el estado esperado obtiene la reserva;
4. solicita a M5 la creación del viaje;
5. guarda el `solicitudId` y cambia a `ACTIVADA`;
6. si M5 falla, cambia la reserva a `FALLIDA`.

El cambio condicionado evita una activación duplicada dentro de una única instancia del proceso.

## Persistencia actual

La implementación usa un `Map<string, Reserva>` privado. Es suficiente para probar el comportamiento funcional y los contenedores sin ejecutar infraestructura adicional.

Esta persistencia no es durable:

- reiniciar M9 elimina las reservas;
- varias réplicas no comparten estado;
- no existe recuperación después de una caída;
- la atomicidad solo está garantizada dentro de un proceso.

La interfaz `ReservaRepository` actúa como puerto de arquitectura. Una futura integración persistente deberá implementar esa interfaz y cambiar únicamente la composición en `src/server.ts`.

## Ejecución con contenedores

`docker-compose.yml` crea tres servicios:

- `m9-reservas`, publicado en el puerto `3000`;
- `m5-stub`, accesible solo dentro de `reservas-network`;
- `m7-stub`, accesible solo dentro de `reservas-network`.

M9 espera que los health checks de ambos stubs sean satisfactorios antes de iniciar. No se definen volúmenes.

## Pruebas

- Las pruebas unitarias cubren reglas de servicio, scheduler y repositorio en memoria.
- Las pruebas de integración consumen la aplicación Express completa.
- Las pruebas E2E levantan los tres contenedores y usan solo las interfaces HTTP públicas.
- El E2E comprueba UI, CRUD, tarifa de M7 y activación automática mediante M5.

Cada ejecución E2E comienza con un proceso M9 nuevo, por lo que el estado inicial está vacío. Al terminar se desmontan los contenedores.
