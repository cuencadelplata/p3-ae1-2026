# Entrega AE1 — M8 Grupo 6 — RF-8.2

## 1. Identificación de la entrega

- **Materia:** Paradigmas III.
- **Entrega:** AE1.
- **Módulo:** M8 — Notificaciones, Documentos y Soporte.
- **Grupo:** 6.
- **Requerimiento:** RF-8.2 — QR de verificación.
- **Responsable:** Goya Bautista.
- **Branch de trabajo:** `feature/m8-r82-qr-grupo6`.

RF-8.1 se desarrolla en `feature/m8-r81-notifications-grupo6`. Ambos requerimientos se integrarán posteriormente en el mismo servicio M8 y en el mismo contrato OpenAPI.

## 2. Alcance verificable

La entrega de RF-8.2 deberá demostrar generación de un QR real con token opaco, asociación interna con `tripId`, temporalidad, validación, vencimiento y uso único. También deberá rechazar la reutilización y asegurar que, ante concurrencia, como máximo una validación del mismo QR resulte exitosa.

El QR no deberá exponer información sensible y M8 no modificará el estado del viaje. El comportamiento funcional completo se encuentra en [rf82-qr.md](rf82-qr.md).

## 3. Requisitos del entorno

- Node.js 24 LTS, alineado con el runtime definido en el Dockerfile del servicio M8.
- pnpm 10.33.0, único gestor de paquetes del proyecto.
- Docker Desktop o Docker Engine para ejecutar el contenedor y las pruebas E2E.
- Git.

No utilizar npm, yarn ni otro gestor de paquetes.

## 4. Instalación

Desde la raíz del proyecto:

```powershell
pnpm install --frozen-lockfile
```

## 5. Configuración

RF-8.2 utilizará la variable externa `QR_TTL_SECONDS` para definir el tiempo de vida del QR. El valor de desarrollo previsto es `300` segundos.

Ejemplo temporal en PowerShell:

```powershell
$env:QR_TTL_SECONDS=300
```

No crear archivos `.env` para esta guía ni configurar secretos, M6, Redis, RabbitMQ o una base de datos. La implementación deberá validar esta configuración según lo definido en [decisiones-tecnicas.md](decisiones-tecnicas.md).

## 6. Verificación técnica

Los comandos existentes en la base del servicio M8 son los siguientes. Sus resultados para RF-8.2 permanecen pendientes hasta que exista implementación.

| Verificación | Comando | Resultado |
| --- | --- | --- |
| TypeScript de la aplicación | `pnpm typecheck` | Pendiente |
| TypeScript de tests | `pnpm typecheck:test` | Pendiente |
| Compilación | `pnpm build` | Pendiente |

## 7. Pruebas

| Suite | Comando | Resultado |
| --- | --- | --- |
| Unit + Integration | `pnpm test` | Pendiente |
| Unit | `pnpm test:unit` | Pendiente |
| Integration | `pnpm test:integration` | Pendiente |
| Coverage | `pnpm test:coverage` | Pendiente |
| E2E Docker | `pnpm test:e2e` | Pendiente |

No se registran cantidades de tests ni cobertura hasta incorporar y ejecutar pruebas reales de RF-8.2.

## 8. Casos funcionales que deberán verificarse

- [ ] Generar un QR para un `tripId` válido.
- [ ] Comprobar que se devuelve un token opaco.
- [ ] Comprobar que se genera una representación QR PNG/Data URL.
- [ ] Verificar que el QR codifica únicamente el token.
- [ ] Comprobar el valor de `expiresAt`.
- [ ] Validar correctamente un QR vigente.
- [ ] Comprobar que la validación exitosa consume el QR.
- [ ] Rechazar la reutilización del QR.
- [ ] Rechazar un QR expirado.
- [ ] Rechazar un token inexistente.
- [ ] Rechazar un token asociado a otro `tripId`.
- [ ] Comprobar que dos validaciones concurrentes no resultan exitosas ambas.
- [ ] Comprobar que M8 no cambia el estado del viaje.

## 9. Verificación de la API

El contrato aprobado está en [docs/api/openapi.yaml](../api/openapi.yaml). Contiene `POST /notifications` de RF-8.1 y los endpoints de RF-8.2: `POST /qr` y `POST /qr/validate`.

### `POST /qr`

Solicitud:

```json
{
  "tripId": "trip-demo-001"
}
```

Respuesta exitosa conceptual:

```json
{
  "token": "...",
  "qrDataUrl": "data:image/png;base64,...",
  "expiresAt": "..."
}
```

### `POST /qr/validate`

Solicitud:

```json
{
  "tripId": "trip-demo-001",
  "token": "..."
}
```

Respuesta exitosa conceptual:

```json
{
  "valid": true
}
```

Los schemas, restricciones, ejemplos y códigos HTTP completos se verifican contra `docs/api/openapi.yaml`; esta guía no los duplica.

## 10. Errores que deberán demostrarse

| Caso | HTTP esperado | Código |
| --- | --- | --- |
| Entrada inválida | 400 | `VALIDATION_ERROR` |
| Tipo de contenido incorrecto | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| QR inexistente o viaje no correspondiente | 404 | `QR_NOT_FOUND` |
| QR ya utilizado | 409 | `QR_ALREADY_USED` |
| QR expirado | 410 | `QR_EXPIRED` |
| Error interno de QR | 500 | `QR_PROCESSING_ERROR` |

## 11. Docker

RF-8.2 deberá ejecutarse dentro del mismo Docker existente del servicio M8; no corresponde crear una segunda imagen. Los comandos de referencia ya usados por la base del servicio son:

```powershell
docker build -t m8-notifications-service:local .
docker run --rm -e PORT=3000 -e QR_TTL_SECONDS=300 -p 3010:3000 m8-notifications-service:local
pnpm test:e2e
```

Resultado: **Pendiente de implementación y ejecución.**

## 12. Persistencia transitoria

Durante AE1 se prevé almacenamiento en memoria para los registros QR, si la implementación mantiene la decisión técnica aprobada. Su estado puede perderse al reiniciar, no representa persistencia definitiva y no requiere incorporar una base de datos únicamente para RF-8.2.

## 13. Requerimientos no funcionales y evidencias

| Aspecto | Evidencia esperada |
| --- | --- |
| Arquitectura modular | RF-8.2 integrado dentro de M8, con responsabilidades separadas. |
| Contrato REST | `docs/api/openapi.yaml`. |
| Contenerización | Ejecución en Docker del mismo servicio M8. |
| Propiedad de datos | M8 conserva únicamente los datos propios del QR. |
| Configuración externa | Uso de `QR_TTL_SECONDS`. |
| Testing | Pruebas Unit, Integration y E2E cuando corresponda. |
| Consistencia | Prueba de uso único y concurrencia. |
| Protección de información | El QR contiene únicamente un token opaco. |
| Documentación y versionado | Documentación y branch correspondiente. |

## 14. Evidencias a guardar para la entrega

- [ ] Salida de `pnpm typecheck`.
- [ ] Salida de `pnpm build`.
- [ ] Resultado de pruebas Unit.
- [ ] Resultado de pruebas Integration.
- [ ] Resultado E2E, si corresponde.
- [ ] Evidencia de ejecución Docker.
- [ ] OpenAPI mostrando los endpoints de RF-8.2.
- [ ] Generación real de QR.
- [ ] Validación exitosa.
- [ ] Rechazo por reutilización.
- [ ] Rechazo por expiración.
- [ ] Prueba de concurrencia.
- [ ] Historial Git y commit correspondiente cuando se realice la entrega.

La fuente de verdad del contrato HTTP es `docs/api/openapi.yaml`.

## 15. Estado actual

RF-8.2 se encuentra en etapa de documentación y contrato previa a la implementación. Las tablas de resultados y las listas de evidencias deberán completarse únicamente después de ejecutar la implementación y obtener evidencia real.

Esta guía se limita a reproducir, verificar y registrar evidencias. Para las decisiones técnicas, el comportamiento funcional y el contrato completo, consultar respectivamente [decisiones-tecnicas.md](decisiones-tecnicas.md), [rf82-qr.md](rf82-qr.md) y [docs/api/openapi.yaml](../api/openapi.yaml).
