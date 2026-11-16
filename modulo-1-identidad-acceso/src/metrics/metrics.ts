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

// ===================== Las 3 métricas del módulo M1 =====================

// 1) RF-1.2 Autenticación (Franco): cuántos logins hubo y cómo terminaron.
// resultado = exitoso (200) | fallido (401, contraseña incorrecta) | bloqueado (429, rate limit)
export const loginsTotal = new client.Counter({
    name: "m1_logins_total",
    help: "RF-1.2 - Intentos de login por resultado",
    labelNames: ["resultado"] as const,
    registers: [registroMetricas]
});

// 2) RF-1.3 Validación de identidad y rol (Adolfo): cuántas veces otros módulos validan un token.
// resultado = valida | usuario_bloqueado | usuario_inexistente | token_rechazado
export const validacionesIdentidadTotal = new client.Counter({
    name: "m1_validaciones_identidad_total",
    help: "RF-1.3 - Validaciones de identidad y rol por resultado",
    labelNames: ["resultado"] as const,
    registers: [registroMetricas]
});

// 3) RF-1.4 Recuperación y revocación de credenciales (Ana).
// operacion = recuperacion_solicitada | contrasena_reseteada | credenciales_revocadas
// resultado = ok | error
export const credencialesTotal = new client.Counter({
    name: "m1_credenciales_total",
    help: "RF-1.4 - Operaciones de recuperación y revocación de credenciales",
    labelNames: ["operacion", "resultado"] as const,
    registers: [registroMetricas]
});

// RF-1.4 (Ana): eventos de recuperación y revocación que M1 publica en RabbitMQ.
// evento = auth.recuperacion_solicitada | auth.credenciales_revocadas
// resultado = publicado (RabbitMQ lo aceptó) | error (RabbitMQ no disponible)
export const eventosCredencialesTotal = new client.Counter({
    name: "m1_eventos_credenciales_total",
    help: "RF-1.4 - Eventos de recuperación y revocación publicados en RabbitMQ",
    labelNames: ["evento", "resultado"] as const,
    registers: [registroMetricas]
});

// Los contadores arrancan en 0 para que los gráficos de Grafana tengan sus líneas desde el inicio.
for (const resultado of ["exitoso", "fallido", "bloqueado"]) {
    loginsTotal.inc({ resultado }, 0);
}

for (const resultado of ["valida", "usuario_bloqueado", "usuario_inexistente", "token_rechazado"]) {
    validacionesIdentidadTotal.inc({ resultado }, 0);
}

for (const operacion of ["recuperacion_solicitada", "contrasena_reseteada", "credenciales_revocadas"]) {
    for (const resultado of ["ok", "error"]) {
        credencialesTotal.inc({ operacion, resultado }, 0);
    }
}

for (const evento of ["auth.recuperacion_solicitada", "auth.credenciales_revocadas"]) {
    for (const resultado of ["publicado", "error"]) {
        eventosCredencialesTotal.inc({ evento, resultado }, 0);
    }
}

// ===================== Métricas técnicas de soporte =====================

// 1 si la dependencia está conectada, 0 si no. Sirve para mostrar qué pasa al apagar Redis o RabbitMQ.
export const dependenciaDisponible = new client.Gauge({
    name: "m1_dependencia_disponible",
    help: "1 si la dependencia está conectada, 0 si no",
    labelNames: ["dependencia"] as const,
    registers: [registroMetricas]
});

dependenciaDisponible.set({ dependencia: "redis" }, 0);
dependenciaDisponible.set({ dependencia: "rabbitmq" }, 0);

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
