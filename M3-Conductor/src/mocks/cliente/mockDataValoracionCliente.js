// Mocks iniciales para desarrollo y pruebas del módulo M3 (Conductores y Valoraciones)

const mockConductores = [
  {
    usuarioID: "cond_001",
    ciudad: "Corrientes",
    tipovehiculo: "auto",
    licenciaId: "lic_ar_1001",
    vehiculoId: "veh_cor_555",
    habilitado: "activo",
    estado_conexion: "conectado"
  },
  {
    usuarioID: "cond_002",
    ciudad: "Resistencia",
    tipovehiculo: "moto",
    licenciaId: "lic_ar_1002",
    vehiculoId: "veh_res_888",
    habilitado: "activo",
    estado_conexion: "desconectado"
  },
  {
    usuarioID: "cond_003",
    ciudad: "Posadas",
    tipovehiculo: "auto",
    licenciaId: "lic_ar_1003",
    vehiculoId: "veh_pos_111",
    habilitado: "pendiente",
    estado_conexion: "desconectado"
  }
];

// Mismo contrato que AMQP: evaluador = conductor, evaluado = pasajero
const mockValoraciones = [
  {
    id: "val_pas_001",
    evaluadorId: "cond_001",
    evaluadoId: "pasajero_101",
    valoracion: 5,
    comentario: "Pasajero muy educado y amable.",
    fecha: "2026-09-01T10:30:00.000Z"
  },
  {
    id: "val_pas_002",
    evaluadorId: "cond_002",
    evaluadoId: "pasajero_102",
    valoracion: 4,
    comentario: "Llegó a tiempo y el trato fue muy cordial.",
    fecha: "2026-09-01T14:15:00.000Z"
  },
  {
    id: "val_pas_003",
    evaluadorId: "cond_003",
    evaluadoId: "pasajero_103",
    valoracion: 1,
    comentario: "Pasajero muy grosero y no respetó las normas de convivencia.",
    fecha: "2026-09-01T10:30:00.000Z"
  }
];

module.exports = {
  mockConductores,
  mockValoraciones
};
