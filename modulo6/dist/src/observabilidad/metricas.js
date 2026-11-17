import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
// Métricas Prometheus de M6 (RNF-19). Grafana Alloy las lee de GET /metrics.
// Los nombres siguen el prefijo m6_ para no mezclarse con los de otros módulos en Grafana Cloud.
export const registro = new Registry();
registro.setDefaultLabels({ service: process.env.OTEL_SERVICE_NAME ?? 'm6-viajes', modulo: 'm6' });
collectDefaultMetrics({ register: registro, prefix: 'm6_' });
export const solicitudesHttp = new Counter({
    name: 'm6_http_requests_total',
    help: 'Solicitudes HTTP atendidas por M6',
    labelNames: ['method', 'route', 'status'],
    registers: [registro],
});
export const duracionHttp = new Histogram({
    name: 'm6_http_request_duration_seconds',
    help: 'Duración de las solicitudes HTTP de M6',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registro],
});
/** RF-6.4: resultado de cada intento de finalización. */
export const finalizaciones = new Counter({
    name: 'm6_finalizaciones_total',
    help: 'Intentos de finalización de viajes por resultado y método de pago',
    labelNames: ['resultado', 'metodo_pago'],
    registers: [registro],
});
export const duracionFinalizacion = new Histogram({
    name: 'm6_finalizacion_duration_seconds',
    help: 'Duración de la finalización, incluidas las llamadas a M4 y M7',
    labelNames: ['resultado'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registro],
});
/** Llamadas a dependencias externas (M4, M7) para evidenciar timeouts y fallas. */
export const llamadasDependencia = new Histogram({
    name: 'm6_dependencia_request_duration_seconds',
    help: 'Duración de las llamadas de M6 a otros módulos',
    labelNames: ['dependencia', 'operacion', 'resultado'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registro],
});
/** RF-6.7: consultas al historial y al registro de viajes. */
export const consultasHistorial = new Counter({
    name: 'm6_historial_consultas_total',
    help: 'Consultas al historial de transiciones y al registro de viajes',
    labelNames: ['tipo', 'resultado'],
    registers: [registro],
});
export const eventosPublicados = new Counter({
    name: 'm6_eventos_publicados_total',
    help: 'Eventos de viaje publicados en RabbitMQ desde el outbox',
    labelNames: ['exchange', 'routing_key'],
    registers: [registro],
});
export const erroresPublicacion = new Counter({
    name: 'm6_eventos_publicacion_errores_total',
    help: 'Fallos al publicar eventos del outbox (se reintentan)',
    registers: [registro],
});
/**
 * Crea en 0 todas las series conocidas de finalización e historial.
 * Prometheus calcula rate()/increase() a partir de la diferencia entre lecturas: si una serie
 * nace directamente en 1 con el primer evento, ese evento no se ve como incremento. Con las
 * series ya en 0 desde el arranque, la primera finalización de cada tipo aparece en Grafana.
 */
export function inicializarSeriesDominio() {
    const resultados = ['completado', 'repetida', 'no_encontrado', 'estado_invalido', 'pago_rechazado',
        'error_dependencia', 'datos_invalidos', 'error_interno'];
    for (const resultado of resultados) {
        duracionFinalizacion.zero({ resultado });
        for (const metodo_pago of ['efectivo', 'tarjeta', 'transferencia', 'invalido']) {
            finalizaciones.inc({ resultado, metodo_pago }, 0);
        }
    }
    const operaciones = [
        ['m4', 'estimar_distancia'],
        ['m7', 'estimar_tarifa'],
        ['m7', 'consultar_pago'],
        ['m7', 'registrar_pago'],
        ['m7', 'autorizar_pago'],
    ];
    for (const [dependencia, operacion] of operaciones) {
        for (const resultado of ['ok', 'error'])
            llamadasDependencia.zero({ dependencia, operacion, resultado });
    }
    for (const tipo of ['viaje', 'registro']) {
        for (const resultado of ['ok', 'error', 'no_encontrado'])
            consultasHistorial.inc({ tipo, resultado }, 0);
    }
    for (const [exchange, routing_key] of [
        ['viajes.events', 'viaje.finalizado'],
        ['mobility.events', 'trip.completed'],
        ['trip.events', 'viaje.iniciado'],
        ['trip.events', 'viaje.finalizado'],
        ['trip.events', 'viaje.cancelado'],
    ]) {
        eventosPublicados.inc({ exchange, routing_key }, 0);
    }
}
/**
 * Gauges calculados desde TripDB en cada scrape. Se registran desde el servicio de viajes,
 * que es el único con acceso a la base.
 */
export function registrarGaugesTripDb(consultar) {
    let ultimo;
    let pendiente;
    const refrescar = () => {
        pendiente ??= consultar()
            .then((valores) => { ultimo = valores; })
            .catch(() => { ultimo = undefined; })
            .finally(() => { pendiente = undefined; });
        return pendiente;
    };
    new Gauge({
        name: 'm6_viajes_por_estado',
        help: 'Viajes registrados en TripDB por estado actual',
        labelNames: ['estado'],
        registers: [registro],
        async collect() {
            await refrescar();
            this.reset();
            for (const { estado, total } of ultimo?.porEstado ?? [])
                this.set({ estado }, total);
        },
    });
    new Gauge({
        name: 'm6_outbox_pendientes',
        help: 'Eventos del outbox todavía no publicados en RabbitMQ',
        registers: [registro],
        async collect() {
            await refrescar();
            if (ultimo)
                this.set(ultimo.outboxPendientes);
        },
    });
    new Gauge({
        name: 'm6_tripdb_disponible',
        help: '1 si la última consulta a TripDB respondió, 0 si falló',
        registers: [registro],
        async collect() {
            await refrescar();
            this.set(ultimo ? 1 : 0);
        },
    });
}
/** Mide una operación y registra su resultado en un histograma con etiquetas. */
export async function medir(histograma, etiquetas, fn) {
    const fin = histograma.startTimer(etiquetas);
    try {
        const resultado = await fn();
        fin({ resultado: 'ok' });
        return resultado;
    }
    catch (error) {
        fin({ resultado: 'error' });
        throw error;
    }
}
