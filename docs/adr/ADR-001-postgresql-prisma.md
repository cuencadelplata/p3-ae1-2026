# ADR-001 — PostgreSQL y Prisma

## Contexto

AE1 guardaba reservas en memoria: un reinicio borraba datos y dos instancias no podían
coordinar transiciones.

## Alternativas

- Mantener InMemory: simple, sin durabilidad.
- PostgreSQL con SQL manual: control máximo, mayor código de infraestructura.
- PostgreSQL con Prisma: migraciones, tipos y transacciones sin acoplar Services al ORM.

## Decisión

PostgreSQL es la fuente de verdad y `PrismaReservaRepository` implementa el puerto
`ReservaRepository`. Los Services no importan Prisma.

## Consecuencias

Se obtiene persistencia, constraints y updates condicionales. Aumentan la dependencia
operativa y la necesidad de migrar antes de iniciar.
