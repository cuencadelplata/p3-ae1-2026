# RF-8.2 — QR de verificación

## Identificación

Grupo 6.

Responsable: Goya Bautista.

Branch de trabajo:

`feature/m8-r82-qr-grupo6`

## Objetivo

RF-8.2 permite que M8 genere y valide un mecanismo QR asociado a un viaje para apoyar la verificación de su inicio.

M8 no inicia el viaje. M6 — Viajes y Ciclo de Vida — utiliza posteriormente el resultado de la validación para decidir si realiza la transición correspondiente.

## Responsabilidad de RF-8.2

M8 debe:

- recibir la referencia de viaje necesaria para generar el QR;
- generar un token seguro;
- generar una representación QR real;
- asociar internamente el token con el viaje;
- establecer su vencimiento;
- validar posteriormente el token;
- comprobar la asociación con el viaje;
- comprobar la vigencia;
- comprobar el uso previo;
- consumir el QR después de una validación exitosa;
- impedir su reutilización.

RF-8.2 debe funcionar realmente durante AE1. Los datos simulados solo pueden sustituir dependencias externas aún no integradas.

## Relación entre M6 y M8

El flujo funcional esperado es:

```text
M6 solicita generación
        ↓
M8 genera QR
        ↓
Usuario presenta QR
        ↓
M6 solicita validación
        ↓
M8 valida y consume si corresponde
        ↓
M8 devuelve resultado
        ↓
M6 decide iniciar o rechazar el inicio
```

M8 no administra estados del viaje ni implementa `EN_CURSO`. Tampoco administra conductor, cliente, origen, destino, tarifa ni pagos.

## Información externa durante AE1

Durante AE1 no existe una integración completa con M6. El dato externo mínimo es conceptualmente:

`tripId`

Representa la referencia que M6 proporcionará en la integración futura. Los mocks o datos simulados solo representan ese origen externo.

M8 no debe crear una lista ficticia completa de viajes. Tampoco debe simular generación, expiración, validación, consumo ni control de uso único: esas son responsabilidades reales de RF-8.2.

## Generación del QR

Cuando se solicita un QR para un viaje, M8 debe:

1. recibir y validar el `tripId`;
2. generar un token opaco;
3. asociarlo internamente con el viaje;
4. registrar su creación;
5. calcular su expiración;
6. generar una representación QR real;
7. devolver el resultado necesario para presentar y utilizar el QR.

La generación no modifica el estado del viaje ni comprueba información que pertenezca a M6.

## Contenido del QR

El QR contiene únicamente un token opaco. La relación con el viaje permanece dentro de M8.

No debe contener directamente:

- `tripId`;
- `userId`;
- nombres ni datos personales;
- conductor;
- origen o destino;
- email o teléfono;
- precio o pago;
- credenciales;
- información completa del viaje.

Por ello, leer el contenido del QR no debe revelar información sensible del viaje o de sus participantes.

## Temporalidad

Todo QR tiene fecha de creación y fecha de expiración. Al alcanzar o superar `expiresAt`, deja de ser válido.

Un QR expirado no puede validarse correctamente ni consumirse para habilitar una acción de M6. La política de TTL se configura externamente mediante `QR_TTL_SECONDS`, según lo definido en las decisiones técnicas.

## Validación del QR

La validación debe comprobar, como mínimo:

1. que la entrada sea válida;
2. que el token exista;
3. que esté asociado al `tripId` indicado;
4. que continúe vigente;
5. que no haya sido utilizado antes.

Si todas las condiciones se cumplen, la validación es exitosa, el QR queda consumido, se registra su utilización y M8 devuelve el resultado correspondiente.

M8 no inicia el viaje después de validar. Esa decisión y la transición de estado pertenecen a M6.

## Uso único

Una validación exitosa consume definitivamente ese QR. Una segunda validación del mismo QR debe ser rechazada.

Como criterio funcional, dos intentos concurrentes sobre el mismo QR no pueden producir dos validaciones exitosas.

## Múltiples QR para un mismo viaje

RF-8.2 no establece explícitamente que solo pueda existir un QR por viaje. Cada QR individual debe ser temporal y de un solo uso.

La multiplicidad de QR por viaje es una decisión pendiente y no requerida actualmente; no debe convertirse en una restricción inventada durante AE1.

## Comportamientos inválidos

RF-8.2 debe rechazar, como mínimo:

- entrada inválida;
- token inexistente;
- QR asociado a otro viaje;
- QR expirado;
- QR ya utilizado.

Estos casos deben producir un resultado de validación rechazado. La representación HTTP, los códigos de estado y los códigos de error definitivos se cerrarán al revisar OpenAPI, manteniendo el formato uniforme de errores de M8.

## Contrato REST previsto

RF-8.2 se expondrá inicialmente mediante:

- `POST /qr`, para generar un QR;
- `POST /qr/validate`, para validar y consumir un QR.

No se requieren endpoints adicionales para cumplir el alcance actual. La definición HTTP detallada pertenece a `docs/api/openapi.yaml`.

## Criterios de aceptación

RF-8.2 se considera funcionalmente correcto cuando:

- puede generarse un QR para un `tripId`;
- se genera un token diferente y no predecible;
- se produce una representación QR real;
- el QR no expone información sensible;
- queda asociado internamente al viaje;
- posee vencimiento;
- un QR vigente puede validarse correctamente;
- un QR expirado es rechazado;
- un QR inexistente es rechazado;
- un QR correspondiente a otro viaje es rechazado;
- una validación exitosa consume el QR;
- una segunda validación es rechazada;
- dos validaciones concurrentes no pueden ser exitosas ambas;
- M8 no modifica el estado del viaje.

## Requerimientos no funcionales relacionados

Durante AE1, esta especificación se relaciona directamente con:

- arquitectura modular: QR permanece dentro de M8 y no duplica M6;
- propiedad de datos: M8 conserva solo la información propia del QR;
- contratos REST y OpenAPI: las operaciones se definen antes de implementarse;
- configuración externa: la vigencia se controla desde M8;
- consistencia y concurrencia: el consumo es único;
- protección de información: RF-8.2 exige directamente que el QR no exponga información sensible; no se adelantan controles de seguridad correspondientes a etapas posteriores;
- testing: la generación, vencimiento y consumo deben ser verificables;
- contenerización, documentación y versionado: forman parte de la evidencia AE1.

No se adelantan requisitos propios de AE2 o AE4. RabbitMQ y Redis no son necesarios para este requisito en AE1.

## Fuera de alcance

RF-8.2 no implementa:

- RF-8.1;
- comprobantes PDF, reenvío ni tickets de soporte;
- RabbitMQ o Redis;
- autenticación propia;
- administración del viaje;
- transición a `EN_CURSO`;
- tarifas o pagos;
- frontend o aplicación móvil de escaneo;
- almacenamiento completo del viaje.
