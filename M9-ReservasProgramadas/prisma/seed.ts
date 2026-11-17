import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.reservation.upsert({
    where: { id: '90000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '90000000-0000-4000-8000-000000000001',
      clientId: '20000000-0000-4000-8000-000000000001',
      origin: 'Terminal de demostración',
      destination: 'Aeropuerto de demostración',
      vehicleType: 'AUTO',
      scheduledAt: new Date('2099-01-01T12:00:00.000Z'),
      status: 'PROGRAMADA',
      currency: 'ARS',
    },
  });
} finally {
  await prisma.$disconnect();
}
