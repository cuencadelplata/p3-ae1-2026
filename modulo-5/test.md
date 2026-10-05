
# Listar imágenes locales del módulo 5
docker image ls agustinq19/m5-dispatch-service


**Etiquetas disponibles:** `v0.6`, `v1.0`, `v1.1`, `latest`


# Descargar todas las versiones
docker pull agustinq19/m5-dispatch-service:v0.6
docker pull agustinq19/m5-dispatch-service:v1.0
docker pull agustinq19/m5-dispatch-service:v1.1
docker pull agustinq19/m5-dispatch-service:latest

# Levantar el contenedor M5 en background
docker run --rm -d --name m5-demo-final -p 3005:3005 agustinq19/m5-dispatch-service:latest

# Esperar a que el servicio esté listo
Start-Sleep -Seconds 3

# Verificar que el contenedor esté corriendo
docker ps --filter "name=m5-demo-final"

## VERIFICAR ESTADO DEL SERVIDOR
Invoke-WebRequest http://localhost:3005/health -UseBasicParsing


## Página principal (Interfaz HTML)
Start-Process "http://localhost:3005/"


## OpenAPI Spec (YAML)
Start-Process "http://localhost:3005/openapi/openapi-m5.yaml"


# DETENER EL CONTENEDOR
docker stop m5-demo-final


# Detener el contenedor de demo si quedó activo
docker stop m5-demo-final 2>$null
# VERIFICAR CONTENEDORES CORRIENDO
docker ps
# ELIMINAR IMAGENES
docker rmi agustinq19/m5-dispatch-service:v0.6
docker rmi agustinq19/m5-dispatch-service:v1.0
docker rmi agustinq19/m5-dispatch-service:v1.1
docker rmi agustinq19/m5-dispatch-service:latest

