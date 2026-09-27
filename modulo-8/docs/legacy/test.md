Mostrar imagenes publicadas
     docker image ls juanmainval/m8-notificaciones-qr
ver etiquetas 0.1.0 0.2.0 1.0.0

ejecutamos la imagen final publicada

docker run --rm -d --name m8-demo-final -p 3000:3000 juanmainval/m8-notificaciones-qr:1.0.0
Start-Sleep -Seconds 3
docker ps --filter "name=m8-demo-final"

espero ver 0.0.0.0:3000->3000/tcp

luego verifico salud del server
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing

espero statuscode 200 y {"status":"ok","service":"m8"}

luego abrimos en navegador
http://localhost:3000/

vemos swagger, sopenapi y simulacion
http://localhost:3000/api-docs/
http://localhost:3000/openapi.yaml

mostramos las pruebas
pnpm test
su cobertura
pnpm test:coverage


detengo el contenedor final
docker stop m8-demo-final