# Pruebas de rendimiento de M4 con k6

Estas pruebas se ejecutan en un contenedor separado. No agregan carga ni dependencias a la API cuando no se utilizan.

## Pruebas disponibles

- `smoke.js`: verifica liveness, readiness, busqueda de conductores y estimacion de distancia.
- `load-nearby.js`: aumenta gradualmente hasta 10 usuarios virtuales sobre `GET /api/v1/drivers/nearby`.

## Ejecutar localmente

Primero levantar M4 y sus dependencias:

```powershell
docker compose up -d --build
docker compose ps
```

Ejecutar la prueba minima:

```powershell
docker compose --profile performance run --rm k6 run /scripts/smoke.js
```

Ejecutar la prueba de carga:

```powershell
docker compose --profile performance run --rm k6 run /scripts/load-nearby.js
```

Los scripts usan `http://m4-api:3004` dentro de Docker. Para apuntar a otra instalacion:

```powershell
docker compose --profile performance run --rm k6 run -e K6_BASE_URL=http://host.docker.internal:3004 /scripts/smoke.js
```

## Enviar resultados a Grafana Cloud

Crear una cuenta o stack en Grafana Cloud y obtener un token personal desde `Testing & synthetics > Performance > Settings`. Tambien se necesita la URL del stack, por ejemplo `https://equipo.grafana.net`. No guardar esos valores en Git.

En PowerShell:

```powershell
$env:K6_CLOUD_TOKEN="TOKEN_PERSONAL"
$env:K6_CLOUD_STACK="https://equipo.grafana.net"

docker compose --profile performance run --rm `
  -e K6_CLOUD_TOKEN `
  -e K6_CLOUD_STACK `
  --entrypoint sh k6 `
  -c 'k6 cloud login --token "$K6_CLOUD_TOKEN" --stack "$K6_CLOUD_STACK" && k6 cloud run --local-execution -e K6_BASE_URL=http://m4-api:3004 /scripts/load-nearby.js'
```

El comando imprime la URL del dashboard de la ejecucion. Grafana Cloud conserva y permite comparar latencia, tasa de errores, solicitudes, usuarios virtuales y thresholds.

Al terminar, eliminar las credenciales de la terminal:

```powershell
Remove-Item Env:K6_CLOUD_TOKEN
Remove-Item Env:K6_CLOUD_STACK
```

## Criterios iniciales

- Menos de 1% de solicitudes fallidas.
- Mas de 99% de checks correctos en la prueba de carga.
- Percentil 95 de `nearby` menor a 500 ms.

Estos valores son una linea de base del equipo y se deben ajustar si la consigna de AE3 indica otros limites.
