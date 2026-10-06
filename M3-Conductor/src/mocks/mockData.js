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

const mockValoraciones = [
  {
    id: "val_001",
    usuarioId: "pasajero_101",
    conductorId: "cond_001",
    valoracion: 5,
    comentario: "Excelente viaje, manejo muy prudente y auto limpio.",
    fecha: "2026-09-01T10:30:00.000Z"
  },
  {
    id: "val_002",
    usuarioId: "pasajero_102",
    conductorId: "cond_001",
    valoracion: 4,
    comentario: "Llegó a tiempo y el trato fue muy cordial.",
    fecha: "2026-09-01T14:15:00.000Z"
  },
  {
    id: "val_003",
    usuarioId: "pasajero_103",
    conductorId: "cond_002",
    valoracion: 5,
    comentario: "Muy rápido y seguro.",
    fecha: "2026-09-02T09:00:00.000Z"
  }
];

module.exports = {
  mockConductores,
  mockValoraciones
};
