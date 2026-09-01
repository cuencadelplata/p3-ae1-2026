# Arquitectura inicial

```text
Cliente REST
    |
    v
M9 – Reservas Programadas
    |-- routes -> controllers -> services -> repositories
    |                                      |
    |                                      v
    |                                Supabase Cloud
    |
    |-- clients -> M5 / M7 (futuro)
    `-- jobs -> activación programada (futuro)
```

En esta etapa solamente existen las piezas requeridas por el endpoint de salud y la infraestructura compartida. Las capas `services`, `repositories`, `clients`, `schemas`, `domain` y `jobs` se incorporarán cuando exista comportamiento real que ubicar en ellas; no se agregan archivos vacíos ni implementaciones anticipadas.

## Reglas de dependencia

- Las rutas solamente registran endpoints y delegan en controllers.
- Los controllers adaptan HTTP; no contienen acceso a datos ni reglas de negocio.
- Los services contendrán los casos de uso y dependerán de abstracciones de repositories y clients.
- Los repositories serán la única capa con acceso a Supabase.
- Los clients encapsularán las llamadas REST hacia M5 y M7.
- Los jobs invocarán casos de uso; no accederán directamente a Supabase ni a otros servicios.
