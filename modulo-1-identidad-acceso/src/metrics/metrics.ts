import {
    NextFunction,
    Request,
    Response
} from "express";
import client from "prom-client";

// Registro propio de M1: guarda todas las métricas que se exponen en GET /metrics.
export const registroMetricas = new client.Registry();

// Métricas del proceso (CPU, memoria, event loop) con el prefijo m1_.
client.collectDefaultMetrics({
    register: registroMetricas,
    prefix: "m1_"
});

// RF-1.2: cuántos logins hubo y cómo terminaron.
// resultado = exitoso (200) | fallido (401) | bloqueado (429)
export const loginsTotal = new client.Counter({
    name: "m1_logins_total",
    help: "Intentos de login por resultado",
    labelNames: ["resultado"] as const,
    registers: [registroMetricas]
});

// RF-1.2: cuántas veces una IP llegó al límite de intentos fallidos.
export const ipsBloqueadasTotal = new client.Counter({
    name: "m1_ips_bloqueadas_total",
    help: "Veces que una IP llegó al límite de intentos fallidos",
    registers: [registroMetricas]
});

// RF-1.2: eventos enviados a RabbitMQ.
// resultado = ok | error (por ejemplo, RabbitMQ caído)
export const eventosPublicadosTotal = new client.Counter({
    name: "m1_eventos_publicados_total",
    help: "Eventos publicados en RabbitMQ por evento y resultado",
    labelNames: ["evento", "resultado"] as const,
    registers: [registroMetricas]
});

// 1 si la dependencia está conectada, 0 si no. Sirve para mostrar qué pasa al apagar Redis o RabbitMQ.
export const dependenciaDisponible = new client.Gauge({
    name: "m1_dependencia_disponible",
    help: "1 si la dependencia está conectada, 0 si no",
    labelNames: ["dependencia"] as const,
    registers: [registroMetricas]
});

dependenciaDisponible.set({ dependencia: "redis" }, 0);
dependenciaDisponible.set({ dependencia: "rabbitmq" }, 0);

// Los contadores arrancan en 0 para que los gráficos de Grafana tengan sus líneas desde el inicio.
for (const resultado of ["exitoso", "fallido", "bloqueado"]) {
    loginsTotal.inc({ resultado }, 0);
}

for (const evento of ["auth.login_exitoso", "auth.ip_bloqueada"]) {
    for (const resultado of ["ok", "error"]) {
        eventosPublicadosTotal.inc({ evento, resultado }, 0);
    }
}

// Cuánto tarda cada respuesta HTTP, por ruta y código.
export const duracionHttp = new client.Histogram({
    name: "m1_http_request_duration_seconds",
    help: "Duración de las respuestas HTTP en segundos",
    labelNames: ["metodo", "ruta", "codigo"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registroMetricas]
});

// Middleware: mide el tiempo de cada pedido y lo guarda al terminar la respuesta.
export function medirDuracion(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (req.path === "/metrics") {
        next();
        return;
    }

    const terminar = duracionHttp.startTimer();

    res.on("finish", () => {
        // Se usa la ruta del router (/auth/me), no la URL real, para no crear una serie por cada valor distinto.
        const ruta = req.route
            ? `${req.baseUrl}${req.route.path}`
            : "sin_ruta";

        terminar({
            metodo: req.method,
            ruta,
            codigo: String(res.statusCode)
        });
    });

    next();
}

// GET /metrics: texto en el formato que lee Prometheus / Grafana Alloy.
export async function exponerMetricas(
    _req: Request,
    res: Response
): Promise<void> {
    res.setHeader("Content-Type", registroMetricas.contentType);
    res.end(await registroMetricas.metrics());
}
