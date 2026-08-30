const TipoDocumento = Object.freeze({
  LICENCIA_CONDUCIR: "LICENCIA_CONDUCIR",
  SEGURO_VEHICULO: "SEGURO_VEHICULO",
  CEDULA_VEHICULO: "CEDULA_VEHICULO",
});

const EstadoDocumento = Object.freeze({
  PENDIENTE: "PENDIENTE",
  APROBADO: "APROBADO",
  RECHAZADO: "RECHAZADO",
});

// validacion reglas de Documentación
function validarDocumento(datos) {
  if (!datos.driverId || typeof datos.driverId !== 'string') {
    throw new Error('El driverId es obligatorio.');
  }

  const tiposValidos = Object.values(TipoDocumento);
  if (!datos.tipoDocumento || !tiposValidos.includes(datos.tipoDocumento.toUpperCase())) {
    throw new Error(`Tipo de documento inválido. Opciones permitidas: ${tiposValidos.join(', ')}`);
  }

  if (!datos.numeroDocumento || datos.numeroDocumento.trim() === '') {
    throw new Error('El número de documento o póliza es obligatorio.');
  }

  if (!datos.archivoUrl || datos.archivoUrl.trim() === '') {
    throw new Error('La URL del archivo es obligatoria.');
  }

  //no se pueden registrar documentos vencidos
  const fechaExp = new Date(datos.fechaVencimiento);
  if (isNaN(fechaExp.getTime()) || fechaExp <= new Date()) {
    throw new Error('La fecha de vencimiento debe ser una fecha válida y posterior al día de hoy.');
  }

  // seguro y cédula requieren estar asociados a un vehículo
  const tipoDoc = datos.tipoDocumento.toUpperCase();
  const requiereVehiculo = (tipoDoc === TipoDocumento.SEGURO_VEHICULO || tipoDoc === TipoDocumento.CEDULA_VEHICULO);
  
  if (requiereVehiculo && (!datos.vehicleId || datos.vehicleId.trim() === '')) {
    throw new Error(`El documento de tipo ${tipoDoc} debe estar asociado a un vehicleId.`);
  }
}