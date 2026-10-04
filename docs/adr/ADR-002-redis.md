# ADR-002 — Redis para caché y coordinación

## Contexto

Las consultas repetidas y la activación concurrente necesitan estado rápido y compartido.

## Alternativas

- Caché/local lock: no funciona entre procesos.
- Solo PostgreSQL: consistente, pero no cubre el objetivo AE2 de estado efímero.
- Redis: TTL nativo, acceso compartido y lock con token.

## Decisión

Usar cache-aside con TTL e invalidación y lock `SET NX PX` liberado mediante Lua. Redis no
es fuente de verdad; PostgreSQL conserva la condición final de estado.

## Consecuencias

Una caída de Redis degrada caché/coordinación, pero no borra reservas. La garantía de no
duplicación no depende del TTL del lock.
