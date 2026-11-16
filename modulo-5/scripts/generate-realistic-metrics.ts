import dotenv from 'dotenv';
dotenv.config();

import { TelemetryService } from '../src/services/telemetry.service';

async function generateTraffic() {
  console.log(' Generando tráfico realista para que el dashboard se vea completo y profesional...');
  const telemetry = TelemetryService.getInstance();

  // Simular solicitudes de viajes
  for (let i = 0; i < 18; i++) {
    telemetry.recordRideRequestCreated('AUTO', 'SEARCHING');
  }
  for (let i = 0; i < 9; i++) {
    telemetry.recordRideRequestCreated('MOTO', 'SEARCHING');
  }
  telemetry.recordRideRequestCreated('AUTO', 'NO_DRIVERS_AVAILABLE');

  // Simular ofertas a conductores
  for (let i = 0; i < 28; i++) {
    telemetry.recordDriverOffer('SENT');
  }
  for (let i = 0; i < 16; i++) {
    telemetry.recordDriverOffer('ACCEPTED');
  }
  for (let i = 0; i < 7; i++) {
    telemetry.recordDriverOffer('REJECTED');
  }
  for (let i = 0; i < 5; i++) {
    telemetry.recordDriverOffer('EXPIRED');
  }

  // Simular cancelaciones
  telemetry.recordRideCancelled('PRE_DISPATCH');
  telemetry.recordRideCancelled('PRE_DISPATCH');
  telemetry.recordRideCancelled('OFFERED');

  console.log('⏳ Enviando a Grafana Cloud...');
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await telemetry.shutdown();
  console.log('🎉 ¡Tráfico cargado exitosamente!');
}

generateTraffic().catch(console.error);
