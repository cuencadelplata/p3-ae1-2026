import { EstadoReserva, PrismaClient, TipoVehiculo } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const reservas = [
    {
      id: '00000000-0000-4000-8000-000000000101',
      clienteId: '00000000-0000-4000-8000-000000000001',
      origen: 'Terminal de Ómnibus',
      destino: 'Aeropuerto',
      vehiculo: TipoVehiculo.AUTO,
      fechaHoraProgramada: new Date('2099-01-01T14:30:00-03:00'),
      estado: EstadoReserva.PENDIENTE_ASIGNACION,
      tarifaEstimada: 1250.5,
      moneda: 'ARS',
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: 'SOL-001',
    },
    {
      id: '00000000-0000-4000-8000-000000000102',
      clienteId: '00000000-0000-4000-8000-000000000002',
      origen: 'Centro',
      destino: 'Puerto',
      vehiculo: TipoVehiculo.MOTO,
      fechaHoraProgramada: new Date('2099-02-01T09:15:00-03:00'),
      estado: EstadoReserva.PROGRAMADA,
      tarifaEstimada: 800,
      moneda: 'ARS',
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: 'SOL-002',
      asignacionId: 'asign-002',
      choferId: 'chofer-002',
      nombreChofer: 'Ana Gómez',
      valoracion: 4.8,
    },
  ];

  await prisma.$transaction([
    prisma.reserva.createMany({
      data: reservas.map((item) => ({
        id: item.id,
        clienteId: item.clienteId,
        origen: item.origen,
        destino: item.destino,
        vehiculo: item.vehiculo,
        fechaHoraProgramada: item.fechaHoraProgramada,
        estado: item.estado,
        tarifaEstimada: item.tarifaEstimada,
        moneda: item.moneda,
        criterioAsignacion: item.criterioAsignacion,
        idSolicitud: item.idSolicitud,
        asignacionId: item.asignacionId ?? null,
        choferId: item.choferId ?? null,
        nombreChofer: item.nombreChofer ?? null,
        valoracion: item.valoracion ?? null,
      })),
      skipDuplicates: true,
    }),
    prisma.reservaVersion.createMany({
      data: reservas.map((item) => ({
        reservaId: item.id,
        version: 1,
        clienteId: item.clienteId,
        origen: item.origen,
        destino: item.destino,
        vehiculo: item.vehiculo,
        fechaHoraProgramada: item.fechaHoraProgramada,
        estado: item.estado,
        asignacionId: item.asignacionId ?? null,
        choferId: item.choferId ?? null,
        nombreChofer: item.nombreChofer ?? null,
        valoracion: item.valoracion ?? null,
        tarifaEstimada: item.tarifaEstimada,
        moneda: item.moneda,
        criterioAsignacion: item.criterioAsignacion,
        idSolicitud: item.idSolicitud,
      })),
      skipDuplicates: true,
    }),
  ]);

  console.log('Seed de reservas generado correctamente.');
}

main()
  .catch((error) => {
    console.error('Error al ejecutar el seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
