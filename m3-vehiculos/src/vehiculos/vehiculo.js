const TipoServicio = Object.freeze({
  AUTO: "AUTO",
  MOTO: "MOTO",
});

//validacion reglas vehiculo
function validarVehiculo(datos) {
  if (!datos.driverId || typeof datos.driverId !== "string") {
    throw new Error("El driverId es obligatorio y debe ser un texto.");
  }

  if (
    !datos.patente ||
    typeof datos.patente !== "string" ||
    datos.patente.trim() === ""
  ) {
    throw new Error("La patente es obligatoria.");
  }

  const tiposValidos = Object.values(TipoServicio);
  if (
    !datos.tipoServicio ||
    !tiposValidos.includes(datos.tipoServicio.toUpperCase())
  ) {
    throw new Error(`El tipo de servicio debe ser estrictamente AUTO o MOTO.`);
  }

  const anioActual = new Date().getFullYear();
  if (!datos.anio || datos.anio < 1990 || datos.anio > anioActual + 1) {
    throw new Error("El año del vehículo no es válido.");
  }
}

// instanciar vehiculo
function crearVehiculo({ driverId, patente, marca, modelo, anio, tipoServicio }) {
  const datos = { driverId, patente, marca, modelo, anio, tipoServicio: tipoServicio?.toUpperCase() };
  
  validarVehiculo(datos);

  return {
    id: `veh-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    driverId: datos.driverId,
    patente: datos.patente.trim().toUpperCase(),
    marca: datos.marca || '',
    modelo: datos.modelo || '',
    anio: datos.anio,
    tipoServicio: datos.tipoServicio,
    activo: false,
    createdAt: new Date()
  };
}

module.exports = {
  TipoServicio,
  validarVehiculo,
  crearVehiculo
};