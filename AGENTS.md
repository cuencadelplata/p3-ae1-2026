# Instrucciones de desarrollo

## Contexto del proyecto

Este repositorio corresponde al proyecto AE1 de Paradigmas III.

Antes de realizar cualquier cambio, consultar la documentación disponible en `/docs`.

El documento oficial de la cátedra ubicado en `/docs/references` tiene prioridad ante cualquier contradicción.

Orden de prioridad documental:

1. `docs/references/ISI-Paradigmas3-AE1-Escenario-MovilidadUrbana-2026.pdf`
2. `docs/references/Sprint1-AE1-30_08.pdf`
3. `docs/m8/alcance-m8.md`
4. `docs/m8/decisiones-tecnicas.md`
5. `docs/m8/rf82-qr.md`
6. `docs/api/openapi.yaml`

Los demás documentos de `/docs/references` son material complementario o histórico.

---

## Alcance actual

El trabajo corresponde al:

**Módulo 8 — Notificaciones, Documentos y Soporte.**

Grupo 6:

- RF-8.1 — Notificaciones de viaje.
- RF-8.2 — QR de verificación.

La branch actual destinada a este trabajo es:

`feature/m8-r82-qr-grupo6`

En esta branch trabajar únicamente sobre:

**RF-8.2 — QR de verificación.**

RF-8.1 pertenece al mismo servicio M8, pero se desarrolla en otra branch.

No modificar la lógica de RF-8.1 salvo que sea estrictamente necesario ajustar algún elemento compartido de la API. Si fuera necesario modificar un elemento compartido, el cambio debe preservar compatibilidad y no eliminar comportamiento ya existente.

No implementar funcionalidades correspondientes a otros requerimientos de M8 ni a otros módulos.

No realizar cambios ni commits directamente sobre `main`.

---

## Objetivo de RF-8.2

RF-8.2 debe permitir generar y validar un QR de verificación asociado a un viaje.

El QR deberá ser:

- temporal;
- asociado a un viaje;
- de un solo uso;
- utilizado para validar el inicio de un viaje;
- incapaz de exponer información sensible.

La funcionalidad propia de M8 debe implementarse realmente.

Los mocks sólo podrán utilizarse para reemplazar información o servicios externos que todavía no estén integrados.

---

## Separación de responsabilidades M6 / M8

M8 NO administra el ciclo de vida del viaje.

M6 — Viajes y Ciclo de Vida es responsable de:

- administrar los estados del viaje;
- determinar si un viaje puede comenzar;
- realizar la transición correspondiente al estado de viaje.

M8 es responsable únicamente de:

- generar el QR;
- asociarlo internamente con un viaje;
- controlar su vencimiento;
- validar el QR;
- controlar que sea utilizado una sola vez;
- informar el resultado de la validación.

Flujo conceptual:

M6 solicita QR
→ M8 genera QR
→ usuario presenta QR
→ M6 solicita validación a M8
→ M8 valida y consume el QR
→ M8 responde
→ M6 decide si inicia el viaje

M8 nunca debe cambiar por sí mismo el estado del viaje.

---

## Reglas de negocio del QR

La implementación debe respetar obligatoriamente las siguientes reglas.

### QR temporal

Todo QR debe tener:

- fecha de creación;
- fecha de expiración.

El tiempo de vida debe configurarse externamente.

Utilizar:

`QR_TTL_SECONDS`

Como valor predeterminado de desarrollo puede utilizarse:

`300`

equivalente a cinco minutos.

No distribuir el valor del TTL como una constante repetida por el código.

---

### QR asociado a un viaje

Cada QR debe estar relacionado internamente con un `tripId`.

El identificador del viaje representa información proporcionada por M6.

Durante AE1 no es necesario integrar realmente M6.

No implementar dentro de M8:

- almacenamiento completo del viaje;
- estados del viaje;
- origen;
- destino;
- conductor;
- cliente;
- precio;
- lógica de inicio del viaje.

M8 solamente conserva la referencia mínima necesaria para asociar el QR con el viaje.

---

### QR sin información sensible

El contenido codificado dentro del QR debe ser un token opaco y aleatorio.

NO codificar dentro del QR:

- nombre del cliente;
- usuarioId;
- conductorId;
- origen;
- destino;
- email;
- teléfono;
- precio;
- información del pago;
- credenciales;
- datos personales;
- información completa del viaje.

Preferentemente tampoco codificar directamente `tripId`.

El QR debe contener solamente un token aleatorio que M8 pueda resolver internamente.

Utilizar mecanismos criptográficamente seguros disponibles en Node.js para generar el token.

No utilizar:

- `Math.random()`;
- identificadores secuenciales;
- información predecible;
- secretos hardcodeados.

---

### Token

El token deberá ser:

- opaco;
- suficientemente aleatorio;
- no predecible;
- diferente para cada QR generado.

No imprimir el token completo en logs.

Si se almacena una representación persistente o interna del token, preferir guardar su hash cuando resulte razonable, conservando el token original únicamente durante la respuesta inicial necesaria para construir/presentar el QR.

No agregar una dependencia externa para hashing si Node.js ya proporciona lo necesario mediante `crypto`.

---

### Un solo uso

Un QR válido podrá consumirse solamente una vez.

Cuando una validación sea exitosa:

1. comprobar que existe;
2. comprobar que pertenece al viaje indicado;
3. comprobar que no expiró;
4. comprobar que no fue utilizado;
5. marcarlo como utilizado;
6. responder que la validación fue exitosa.

Una segunda validación del mismo QR debe fallar.

La comprobación y marcado como utilizado deben diseñarse para evitar que dos solicitudes concurrentes puedan validar exitosamente el mismo QR.

En la implementación AE1 de una única instancia Node.js, evitar introducir operaciones asíncronas entre la comprobación del estado y el marcado como utilizado si ello pudiera permitir una carrera.

Agregar una prueba específica para este comportamiento.

---

### Expiración

Un QR cuya fecha de expiración sea anterior o igual al momento de validación debe considerarse inválido.

Un QR expirado:

- no debe validarse;
- no debe poder reutilizarse;
- no debe iniciar ninguna acción correspondiente a M6.

No utilizar esperas reales largas en las pruebas.

Utilizar temporización controlable, fake timers o una abstracción mínima del reloj cuando sea necesario para probar expiración de forma determinista.

---

## API

Trabajar con enfoque:

**Design-First / Contract-First.**

La especificación:

`docs/api/openapi.yaml`

es el contrato de RF-8.2.

No implementar endpoints que contradigan el contrato aprobado.

Los endpoints previstos son:

`POST /qr`

para generar un QR.

`POST /qr/validate`

para validar y consumir un QR.

No agregar endpoints adicionales sin una necesidad derivada del requerimiento.

Mantener:

- códigos HTTP apropiados;
- validación de entradas;
- respuestas consistentes;
- manejo uniforme de errores;
- compatibilidad con las convenciones existentes de RF-8.1.

Si RF-8.1 ya posee middleware, manejo de errores o estructuras compartidas, reutilizarlas cuando corresponda en lugar de crear versiones duplicadas.

---

## Arquitectura

M8 es un servicio con responsabilidades explícitas.

RF-8.2 debe permanecer dentro de M8.

Separar cuando corresponda:

- HTTP/rutas;
- controller;
- lógica de negocio;
- almacenamiento/repositorio;
- generación del QR;
- validación;
- configuración;
- pruebas.

No crear capas, interfaces o patrones únicamente para demostrar conocimientos.

Cada abstracción debe resolver un problema real.

Evitar:

- sobrearquitectura;
- abstracciones prematuras;
- lógica de negocio dentro de controllers;
- duplicación;
- archivos excesivamente grandes;
- dependencias circulares;
- acoplamiento con M6;
- acceso directo a bases de datos pertenecientes a otros módulos.

---

## Persistencia y propiedad de datos

Los datos correspondientes al QR son propiedad lógica de M8.

Como mínimo pueden existir los siguientes datos internos:

- id;
- tripId;
- tokenHash o representación segura equivalente;
- createdAt;
- expiresAt;
- usedAt.

No almacenar una copia completa del viaje.

Durante AE1 puede utilizarse una implementación en memoria si esa es la estrategia adoptada por el servicio actual.

Si se utiliza almacenamiento en memoria:

- encapsular la responsabilidad;
- documentar que el estado se pierde al reiniciar;
- no presentarlo como persistencia definitiva;
- evitar introducir una base de datos únicamente para RF-8.2 sin necesidad.

No consultar directamente tablas pertenecientes a M6 u otros servicios.

---

## Mocks

Durante AE1 todavía no existe integración real M6 → M8.

Los mocks o datos simulados pueden representar únicamente la información externa necesaria, principalmente:

- `tripId`.

No simular la lógica propia del QR.

Deben funcionar realmente:

- generación del token;
- generación del QR;
- expiración;
- validación;
- asociación con el viaje;
- consumo de un solo uso.

---

## Dependencias

Mantener las dependencias al mínimo.

Si es necesaria una biblioteca para producir una representación QR real, utilizar una biblioteca específica, mantenida y de alcance reducido.

No instalar frameworks o paquetes para resolver funcionalidades ya disponibles en Node.js.

No utilizar npm.

Utilizar pnpm para instalar y administrar dependencias.

Antes de agregar una dependencia:

1. comprobar si ya existe una solución en el proyecto;
2. justificar su necesidad;
3. evitar dependencias redundantes.

---

## Configuración

La configuración debe realizarse mediante variables de entorno cuando corresponda.

No hardcodear:

- secretos;
- credenciales;
- tokens;
- cadenas de conexión;
- configuraciones sensibles.

El TTL del QR deberá poder configurarse mediante:

`QR_TTL_SECONDS`

Validar la configuración al iniciar la aplicación.

---

## Calidad

Todo cambio debe considerar:

- mantenibilidad;
- extensibilidad;
- testabilidad;
- seguridad;
- rendimiento razonable;
- consistencia;
- concurrencia;
- manejo de errores;
- claridad del código.

Preferir siempre la solución más simple que satisfaga correctamente RF-8.2.

---

## Pruebas

Toda lógica de negocio incorporada para RF-8.2 deberá poseer pruebas.

Como mínimo contemplar pruebas unitarias para:

- generación de QR;
- generación de token;
- asociación token/viaje;
- cálculo de expiración;
- validación correcta;
- token inexistente;
- viaje incorrecto;
- QR expirado;
- QR ya utilizado;
- reutilización;
- validación concurrente del mismo QR.

Agregar pruebas de integración para:

- `POST /qr`;
- `POST /qr/validate`;
- validaciones de entrada;
- códigos HTTP;
- formato de respuestas;
- formato de errores.

No agregar pruebas E2E únicamente para aumentar el número de tests.

Si el proyecto ya posee infraestructura E2E y aporta valor, incorporar el flujo:

generar → validar → intentar reutilizar.

Antes de considerar una tarea terminada ejecutar, según estén disponibles:

`pnpm typecheck`

`pnpm typecheck:test`

`pnpm build`

`pnpm test`

`pnpm test:unit`

`pnpm test:integration`

`pnpm test:coverage`

`pnpm test:e2e`

Nunca eliminar, omitir o debilitar una prueba únicamente para conseguir que el pipeline pase.

---

## Docker

El servicio debe continuar siendo ejecutable mediante Docker de acuerdo con las convenciones existentes del proyecto.

No crear una segunda imagen o infraestructura Docker exclusivamente para RF-8.2 si forma parte del mismo servicio M8.

Verificar que las nuevas dependencias y variables de entorno funcionen también dentro del contenedor.

---

## Seguridad

RF-8.2 no debe incorporar un sistema propio de autenticación.

No implementar:

- login;
- usuarios;
- contraseñas;
- JWT propio;
- gestión de roles de M1.

Si el servicio ya posee infraestructura de seguridad compartida, reutilizarla sin duplicarla.

No exponer información sensible en:

- contenido del QR;
- respuestas innecesarias;
- errores;
- logs;
- URLs.

---

## Fuera de alcance

En esta branch no implementar:

- RF-8.1 Notificaciones;
- RF-8.3 Comprobante PDF;
- RF-8.4 Reenvío de comprobante;
- RF-8.5 Soporte;
- RF-8.6 RabbitMQ;
- Redis;
- administración del ciclo de viaje;
- lógica de M6;
- tarifas;
- pagos;
- usuarios;
- autenticación propia;
- frontend de escaneo;
- aplicación móvil;
- geolocalización.

---

## Git

Antes de realizar cualquier cambio verificar la branch actual.

La branch esperada es:

`feature/m8-r82-qr-grupo6`

No cambiar de branch sin indicación.

No realizar commits automáticamente salvo solicitud explícita.

No realizar push automáticamente salvo solicitud explícita.

No modificar `main`.

No modificar branches pertenecientes a otros grupos.

No reescribir historial Git sin autorización explícita.

---

## Principio general

Implementar únicamente lo necesario para que RF-8.2 sea correcto, demostrable, reproducible y posteriormente integrable con el resto de M8.

No agregar funcionalidades simplemente porque podrían resultar útiles en una versión futura.

No programar responsabilidades de otros módulos para compensar integraciones que todavía no existen.