# Fuera de alcance de M9 AE2

## QR

El QR temporal y de un solo uso pertenece a M8 y valida el inicio de un viaje administrado
por M6. M9 trabaja antes de que exista el viaje definitivo; no posee el `tripId` ni debe
generar credenciales de inicio. Integración conceptual: M6 publica el estado que habilita
la verificación y M8 genera/notifica el QR.

## PDF

El comprobante se genera después de finalizar/cobrar, con datos de M6 y M7. M8 es dueño del
documento y su distribución. M9 no conoce el resultado final ni debe replicar esa
información.

Estado académico de esta delimitación: `PENDIENTE_CONFIRMACION_ACADEMICA`.

## AE4

Despliegue cloud, alta disponibilidad, observabilidad con métricas/trazas, Circuit Breaker,
pipeline CI/CD y publicación automática se reservan para AE4. Los timeouts y logs básicos
de AE2 sí se mantienen.
