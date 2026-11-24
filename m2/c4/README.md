# Modelo C4 (Structurizr DSL)

`workspace.dsl` define los niveles C1 (contexto), C2 (contenedores) y C3 (componentes de API y worker).

## Ver y editar

```bash
docker run --rm -p 8081:8080 -v "$PWD/c4:/usr/local/structurizr" structurizr/lite
```

Abrir http://localhost:8081.

## Validar

```bash
docker run --rm -v "$PWD/c4:/usr/local/structurizr" structurizr/cli validate -workspace workspace.dsl
```

## Exportar (Mermaid / PlantUML)

```bash
docker run --rm -v "$PWD/c4:/usr/local/structurizr" structurizr/cli export -workspace workspace.dsl -format mermaid
```

Ejecutar los comandos desde `m2/`.
