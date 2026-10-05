# ADR-003: Autenticación Desacoplada y Control de Acceso basado en Roles (RBAC) con M1

- **Estado:** Aprobado / Implementado
- **Fecha:** 2026-10-05
- **Autor:** Matias Costantini
- **Módulo:** Módulo 5 (Solicitud y Despacho)
- **Requerimientos asociados:** RF-1.2, RF-1.3, RNF-04, RNF-10

---

## 1. Contexto y Problema

De acuerdo con las restricciones de AE2 (RNF-04 y RNF-10), queda estrictamente prohibido realizar lecturas directas a las bases de datos de otros módulos (ej. consultar usuarios o contraseñas en `IdentityDB`). La autenticación y autorización deben resolverse delegando la responsabilidad en el servicio centralizado **Módulo 1 (Identidad y Acceso)**.

---

## 2. Alternativas Evaluadas

### Alternativa A: Compartir Clave Secreta JWT y Verificar Localmente
- **Contras:** Obliga a sincronizar secretos criptográficos entre todos los repositorios y no contempla la revocación inmediata de tokens o cambio de roles en tiempo real.

### Alternativa B: Validación Centralizada vía Endpoint M1 (`GET /auth/validar-identidad-y-rol`) — *Seleccionada*
- **Pros:**
  - Cumplimiento estricto del principio de responsabilidad única (*Single Responsibility Principle*).
  - M1 valida la firma, vigencia y rol (`CLIENTE`, `CONDUCTOR`, `ADMIN`).
  - M5 extrae el identificador canónico (`userId`) numérico para asociar solicitudes y ofertas.

---

## 3. Decisión Adoptada

Se implementó el middleware [`auth.middleware.ts`](file:///c:/Users/matia/OneDrive/Documentos/Facultad/3er%20a%C3%B1o/Paradigmas%20III/Proyectos/AE2/p3-ae1-2026/modulo-5/src/middleware/auth.middleware.ts) que expone:

1. `requireAuth`: Extrae el header `Authorization: Bearer <token>`, consulta a `${M1_AUTH_URL}/auth/validar-identidad-y-rol` e inyecta `req.authenticatedUser = { userId, role }`. Si no es válido, retorna `401 Unauthorized`.
2. `requireConductor`: Valida que el usuario autenticado posea estrictamente el rol `CONDUCTOR`. De lo contrario, retorna `403 Forbidden`.
3. **Modo Desarrollo / Fallback:** Si no se provee token en entornos locales de pruebas, inyecta un usuario por defecto para mantener la reproducibilidad de los tests sin dependencias externas obligatorias.

---

## 4. Consecuencias

- **Positivas:**
  - Desacoplamiento total del modelo de datos de usuarios.
  - Endpoints de ofertas (`/api/v1/offers/:id/accept`) blindados ante respuestas de clientes no autorizados.
