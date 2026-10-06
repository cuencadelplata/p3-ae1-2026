# Pruebas manuales desde Scalar

Con los contenedores iniciados, abrir `http://localhost:3004/docs`. Scalar usa el contrato OpenAPI servido por la propia API y permite enviar solicitudes reales.

## Recorrido recomendado

1. Abrir `PUT /drivers/{driverId}/location`.
2. Escribir `scalar-demo` en `driverId` y enviar este cuerpo:

```json
{
  "latitude": -27.4692,
  "longitude": -58.8306,
  "vehicleType": "AUTO",
  "available": true
}
```

La respuesta esperada es `200` con la ubicacion, `updatedAt` y `expiresAt`.

3. Ejecutar `GET /drivers/{driverId}/location` con `scalar-demo`. La respuesta esperada es `200`.
4. Ejecutar `GET /drivers/nearby` con latitud `-27.4692`, longitud `-58.8306`, tipo `AUTO` y radio `5`. La respuesta esperada es `200` y `scalar-demo` debe aparecer entre los candidatos.
5. Ejecutar `PATCH /drivers/{driverId}/availability` con `scalar-demo` y el cuerpo `{ "available": false }`.
6. Repetir la busqueda: el conductor ya no debe aparecer porque no esta disponible.
7. Ejecutar `DELETE /drivers/{driverId}/location` para limpiar la demostracion. La respuesta esperada es `204`.

## Validaciones de error utiles

- Buscar con una latitud fuera del rango `-90` a `90` debe responder `400`.
- Consultar un conductor inexistente debe responder `404`.
- Enviar una ubicacion con una marca temporal anterior a la ya guardada debe responder `409` y el codigo `STALE_LOCATION_UPDATE`.

Estas pruebas no reemplazan los tests automatizados; sirven para demostrar de forma interactiva que el contrato documentado coincide con el comportamiento de la API.
