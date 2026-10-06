# Trazabilidad AE1 → AE2

Insumo recibido: `ae2-paradigmas3-20261005T141611Z-1-001.zip`.

SHA-256: `a4c62c989f8927b1801cfb574b44f63d0fa2097eb06a0935847f4d3e17599754`.

No contenía `.git`, tag, release, URL del repositorio ni commits. Por eso no se inventó historial de autoría ni una supuesta aprobación docente. La referencia verificable disponible es el hash del ZIP y los hashes por archivo de `base-ae1-manifest.json`. La comparación `cambios-ae2.patch` distingue técnicamente las modificaciones; no reemplaza los commits individuales exigidos.

| Elemento | Base recibida | Evolución |
|---|---|---|
| RF implementado | RF-2.4 calificaciones | RF-2.2 direcciones; RF-2.4 conservado |
| Stack | TypeScript/Express/Prisma/PostgreSQL | Conservado |
| Redis | Cache de calificaciones | Lista de direcciones con TTL y revisión |
| Mensajería | Ausente | RabbitMQ, worker, outbox/inbox |
| Integración M6 | REST + mock manual | REST heredado + productor de evento simulado |
| Integración M4/M8 | Ausente | Mapas HTTP y consumidor/bandeja simulada |
| Identidad | Header x-cliente-id confiado | Token firmado; aislamiento de lectura |
| Pruebas/contratos | No incluidos | Unitarias, integración, stack, OpenAPI y eventos |
| Migración | db push | Base versionada + ampliación aditiva |
| Docker | M6 fuera de Compose | Dependencias y simuladores dentro de Compose |

## Incorporar al repositorio verdadero

1. Identificar el tag/commit oficial AE1 con el equipo. No reemplazarlo por este ZIP sin contrastar los archivos.
2. Crear branch individual desde esa referencia, por ejemplo `ae2/<apellido>`.
3. Comparar este proyecto con los archivos reales e incorporar sólo las diferencias pertinentes. `cambios-ae2.patch` se generó contra el ZIP; no aplicarlo a ciegas a una base distinta.
4. Crear tareas/issues reales y commits asociados después de revisar y probar cada cambio. No atribuir al alumno commits ni trabajo previo que no realizó.
5. Ejecutar pruebas contra el stack Docker; incorporar resultados, capturas y reflexión propia.
6. Exportar el ZIP del branch y actualizar el Portafolio con referencias reales, según consigna.

La evolución preparada con asistencia debe revisarse y poder explicarse en la defensa. Los simuladores y contratos propuestos necesitan acuerdo con los demás módulos; no sustituyen contratos que el equipo ya tenga.

## Evolución 2.2.0

Se reutilizó el cliente M6 heredado de RF-2.4 para RF-2.2, aceptando las direcciones textuales del contrato recibido posteriormente. Se agregó el par de viaje y sugerencias para ambos extremos, con regreso B → A, migración aditiva, perfil de conexión M6 real y pruebas nativas de PostgreSQL/RabbitMQ y red sin Internet. El contrato adjunto está preservado en referencias/m6-recibido.txt; no se inventó un GET en ese archivo ni se afirma haber probado el servidor del equipo.
