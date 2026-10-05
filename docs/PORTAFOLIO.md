# Portafolio y reflexión individual — completar con evidencia real

Este documento organiza la entrega; no afirma actividad personal ni aprobación docente que no se haya aportado.

## Identificación

- Estudiante / DNI: **completar**.
- Repositorio del equipo: **completar**.
- Referencia oficial AE1 (tag/commit aceptado): **completar**.
- Branch individual `ae2/<usuario-o-apellido>`: **completar**.
- Alcance RF-2.2 y aprobación docente: **completar / adjuntar constancia**.
- Herramientas de asistencia utilizadas y participación propia: **describir honestamente**.

## Registro de tareas

| Tarea propuesta | Resultado técnico preparado | Issue real | Commit real / evidencia personal |
|---|---|---|---|
| T1 Analizar base y RF-2.2 | ALCANCE y manifiesto del ZIP | Completar | Completar |
| T2 Modelo y REST | Prisma, migraciones, endpoints | Completar | Completar |
| T3 Caché y concurrencia | Redis, revisiones, idempotencia | Completar | Completar |
| T4 Eventos | Outbox/inbox, worker, M6/M8 | Completar | Completar |
| T5 Integración y seguridad | M4 HTTP, token demo, aislamiento | Completar | Completar |
| T6 Pruebas y contratos | Unitarias, integración, OpenAPI | Completar | Completar |
| T7 Validación PostgreSQL/RabbitMQ | Ejecución local y sin Internet verificada; adjuntar evidencia personal | Completar | Completar |

## Reflexión personal (guía, no texto para atribuirse)

1. Explicá por qué elegiste caché de direcciones en lugar de ubicación de conductores para tu alcance.
2. Compará REST y eventos en los dos puntos de integración; justificá qué necesita respuesta inmediata.
3. Mostrá la carrera check-then-insert y cómo la restricción única y las transacciones la evitan.
4. Explicá qué ocurre si el worker cae después de publicar y antes de marcar outbox, y si un consumidor cae después del commit y antes del ack.
5. Describí una dificultad real que encontraste, una alternativa descartada y su evidencia.
6. Registrá el feedback real de la cátedra y qué cambiaste a partir de él. Si aún no hubo feedback, indicarlo.
7. Identificá qué aprendiste, qué implementaste o revisaste personalmente y qué limitaciones quedan para AE4.

Adjuntar capturas propias: health, MISS/HIT y TTL, doble alta, 412, RabbitMQ, DLQ, recuperación tras caída, y resultados contra PostgreSQL 15. Mantener fechas y vínculos a commits reales.
