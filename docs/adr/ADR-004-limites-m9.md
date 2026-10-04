# ADR-004 — Límites de M9

## Contexto

Reservar, despachar, tarifar y documentar son momentos relacionados, pero tienen owners
distintos.

## Alternativas

- Implementar ranking/QR/PDF dentro de M9: demo rápida, alto acoplamiento y duplicación.
- Leer bases ajenas: acceso directo, rompe ownership.
- Integrar por contratos y conservar referencias: separación explícita.

## Decisión

M9 posee reservas; M5 busca/oferta/asigna; M7 calcula tarifa; M8 genera QR/PDF. M9 almacena
solo snapshots o IDs necesarios. RF-9.7 no se simula dentro de M9 sin contrato de M5.

## Consecuencias

Los límites son defendibles y cada módulo puede evolucionar. Algunas funciones quedan
bloqueadas hasta acordar contratos externos en vez de fingirse localmente.
