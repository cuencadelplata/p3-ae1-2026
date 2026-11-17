import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { Counter, Histogram, Meter } from '@opentelemetry/api';

/**
 * Servicio de Telemetría y Métricas con OpenTelemetry (OTel) para Grafana Cloud.
 *
 * Expone las 3 métricas del Módulo 5 (Solicitud y Despacho):
 * 1. m5_ride_requests_total (RF-5.1)
 * 2. m5_driver_offers_total (RF-5.3, RF-5.4, RF-5.5)
 * 3. m5_ride_cancellations_total (RF-5.6)
 */
export class TelemetryService {
  private static instance: TelemetryService | null = null;
  private meterProvider: MeterProvider | null = null;
  private meter: Meter | null = null;

  // Las 3 métricas de negocio + Latencia HTTP
  private rideRequestsCounter: Counter | null = null;
  private driverOffersCounter: Counter | null = null;
  private rideCancellationsCounter: Counter | null = null;
  private httpRequestDurationHistogram: Histogram | null = null;

  private isEnabled = false;

  private constructor() {
    this.init();
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  private init(): void {
    // Si estamos en testing o no hay credenciales, operamos en modo no-op
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;

    if (!endpoint || !rawHeaders || process.env.NODE_ENV === 'test') {
      return;
    }

    try {
      // Parsear header "Authorization=Basic ..."
      const headers: Record<string, string> = {};
      const pairs = rawHeaders.split(',');
      for (const pair of pairs) {
        const [key, ...rest] = pair.split('=');
        if (key && rest.length > 0) {
          headers[key.trim()] = rest.join('=').trim();
        }
      }

      // Normalizar URL: asegurar que apunta a /v1/metrics
      const metricsUrl = endpoint.endsWith('/v1/metrics')
        ? endpoint
        : `${endpoint.replace(/\/$/, '')}/v1/metrics`;

      const exporter = new OTLPMetricExporter({
        url: metricsUrl,
        headers
      });

      const exportIntervalMillis = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 5000);

      const metricReader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis
      });

      const serviceName = process.env.OTEL_SERVICE_NAME || 'm5-dispatch-service';

      this.meterProvider = new MeterProvider({
        resource: resourceFromAttributes({
          'service.name': serviceName,
          'service.version': '2.0.0'
        }),
        readers: [metricReader]
      });

      this.meter = this.meterProvider.getMeter('m5-dispatch-meter');

      // Métrica 1: Solicitudes de Viaje Creadas (RF-5.1)
      this.rideRequestsCounter = this.meter.createCounter('m5_ride_requests_total', {
        description: 'Total de solicitudes de viaje creadas en M5 (RF-5.1)'
      });

      // Métrica 2: Flujo de Ofertas a Conductores (RF-5.3, RF-5.4, RF-5.5)
      this.driverOffersCounter = this.meter.createCounter('m5_driver_offers_total', {
        description: 'Total de ofertas emitidas, aceptadas, rechazadas o vencidas en M5 (RF-5.3/5.4/5.5)'
      });

      // Métrica 3: Cancelaciones de Viajes (RF-5.6)
      this.rideCancellationsCounter = this.meter.createCounter('m5_ride_cancellations_total', {
        description: 'Total de solicitudes de viaje canceladas antes de iniciar (RF-5.6)'
      });

      // Métrica 4: Latencia de Solicitudes HTTP en milisegundos (Performance & Stress k6)
      this.httpRequestDurationHistogram = this.meter.createHistogram('m5_http_request_duration_ms', {
        description: 'Tiempo de respuesta de las solicitudes HTTP en milisegundos'
      });

      this.isEnabled = true;
      console.log(`[OTel] Telemetría OpenTelemetry activa hacia Grafana Cloud (${metricsUrl}) cada ${exportIntervalMillis / 1000}s`);
    } catch (err) {
      console.warn(`[OTel] No se pudo inicializar OpenTelemetry: ${(err as Error).message}`);
    }
  }

  /**
   * RF-5.1: Registra una nueva solicitud de viaje creada
   * @param vehicleType 'AUTO' | 'MOTO'
   * @param status 'SEARCHING' | 'NO_DRIVERS_AVAILABLE'
   */
  public recordRideRequestCreated(vehicleType: string, status: string): void {
    if (this.rideRequestsCounter) {
      this.rideRequestsCounter.add(1, {
        vehicle_type: vehicleType.toUpperCase(),
        status
      });
    }
  }

  /**
   * RF-5.3 / RF-5.4 / RF-5.5: Registra el ciclo de vida de una oferta de conductor
   * @param status 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'
   */
  public recordDriverOffer(status: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'): void {
    if (this.driverOffersCounter) {
      this.driverOffersCounter.add(1, {
        status
      });
    }
  }

  /**
   * RF-5.6: Registra una cancelación previa por parte del cliente
   * @param stage 'PRE_DISPATCH' | 'OFFERED'
   */
  public recordRideCancelled(stage: 'PRE_DISPATCH' | 'OFFERED'): void {
    if (this.rideCancellationsCounter) {
      this.rideCancellationsCounter.add(1, {
        stage
      });
    }
  }

  /**
   * Registra la latencia HTTP de cada petición (ms) para detectar degradación bajo estrés (k6)
   */
  public recordHttpRequestDuration(durationMs: number, method: string, route: string, statusCode: number): void {
    if (this.httpRequestDurationHistogram) {
      this.httpRequestDurationHistogram.record(durationMs, {
        method: method.toUpperCase(),
        route,
        status_code: String(statusCode)
      });
    }
  }

  public async shutdown(): Promise<void> {
    if (this.meterProvider) {
      await this.meterProvider.shutdown();
    }
  }
}
