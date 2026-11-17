import dotenv from 'dotenv';
dotenv.config();

import { TelemetryService } from '../src/services/telemetry.service';

async function main() {
  console.log('🚀 Iniciando envío de métricas de prueba a Grafana Cloud...');
  const telemetry = TelemetryService.getInstance();

  console.log('📊 Registrando métricas del Módulo 5...');

  // 1. RF-5.1: Solicitudes creadas
  telemetry.recordRideRequestCreated('AUTO', 'SEARCHING');
  telemetry.recordRideRequestCreated('AUTO', 'SEARCHING');
  telemetry.recordRideRequestCreated('MOTO', 'SEARCHING');
  console.log('  ✅ m5_ride_requests_total registrado (2 AUTO, 1 MOTO)');

  // 2. RF-5.3 / 5.4 / 5.5: Ofertas a conductores
  telemetry.recordDriverOffer('SENT');
  telemetry.recordDriverOffer('SENT');
  telemetry.recordDriverOffer('ACCEPTED');
  telemetry.recordDriverOffer('REJECTED');
  console.log('  ✅ m5_driver_offers_total registrado (2 SENT, 1 ACCEPTED, 1 REJECTED)');

  // 3. RF-5.6: Cancelaciones previas
  telemetry.recordRideCancelled('PRE_DISPATCH');
  console.log('  ✅ m5_ride_cancellations_total registrado (1 PRE_DISPATCH)');

  console.log('⏳ Esperando 6 segundos para el flush de OpenTelemetry hacia Grafana Cloud...');
  await new Promise((resolve) => setTimeout(resolve, 6000));

  await telemetry.shutdown();
  console.log('🎉 ¡Métricas exportadas exitosamente a Grafana Cloud!');
}

main().catch((err) => {
  console.error('❌ Error al enviar métricas:', err);
});
