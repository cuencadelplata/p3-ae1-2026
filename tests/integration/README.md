# Pruebas Integration

Una prueba Integration verifica varias piezas trabajando juntas. En M8 el flujo conceptual es:

```text
HTTP → Router/Controller → Validator → Service → Store/Provider → respuesta
```

`notifications/` prueba el comportamiento integrado de RF-8.1 mediante `POST /notifications`: composición Express, validación, proveedor PUSH y respuesta pública.

`qr/` prueba el comportamiento integrado de RF-8.2 mediante `POST /qr` y `POST /qr/validate`: validación, servicio, almacenamiento temporal, single-use y concurrencia HTTP.

Existe un archivo integrado por RF porque el objetivo es comprobar el flujo público completo de cada requerimiento. La separación Controller/Service/Validator se comprueba de forma aislada en Unit; duplicarla aquí no agregaría una integración distinta.
