# Modelo C4 de Movilidad Urbana

Diagramas C4 de la plataforma completa (M1–M9), generados con [archify](https://github.com/tt-a1i/archify) v3.3.0. Cada `.html` es autocontenido: se abre directo en el navegador.

| Nivel | Diagrama |
| --- | --- |
| 1 · Contexto | [c4-nivel1-contexto.html](c4-nivel1-contexto.html) |
| 2 · Contenedores | [c4-nivel2-contenedores.html](c4-nivel2-contenedores.html) |
| 2b · Eventos (RabbitMQ) | [c4-nivel2-eventos.html](c4-nivel2-eventos.html) |
| 3 · Componentes | [M1](c4-nivel3-componentes-m1.html) · [M2](c4-nivel3-componentes-m2.html) · [M3](c4-nivel3-componentes-m3.html) · [M4](c4-nivel3-componentes-m4.html) · [M5](c4-nivel3-componentes-m5.html) · [M6](c4-nivel3-componentes-m6.html) · [M7](c4-nivel3-componentes-m7.html) · [M8](c4-nivel3-componentes-m8.html) · [M9](c4-nivel3-componentes-m9.html) |

Desde el Nivel 2, un clic en un módulo abre su Nivel 3.

## De dónde sale

- Niveles 1 y 2: el `docker-compose.yml` común resuelto (`docker compose config`).
- Nivel 3: el código de cada módulo. Cada componente cita archivo y línea; archify verifica que la cita exista en el commit indicado en `meta.repository.revision`.

## Actualizar

Los diagramas no se actualizan solos: cuando cambia un módulo, se edita su `.json` y se regenera el `.html`.

```sh
git clone --depth 1 --branch v3.3.0 https://github.com/tt-a1i/archify.git ~/archify

# validar
node ~/archify/archify/bin/archify.mjs validate architecture c4/c4-nivel2-contenedores.json --quality showcase --repo-root .

# regenerar el HTML
node ~/archify/archify/bin/archify.mjs finalize architecture c4/c4-nivel2-contenedores.json c4/c4-nivel2-contenedores.html --quality showcase --repo-root . --browser-check
```

Ejecutar desde la raíz del repositorio. Al cambiar el código citado, actualizar también `meta.repository.revision` y las líneas de `sources`.
