// Funciones compartidas por los tests end-to-end de la AE4.
// Pegan contra M1, Redis y RabbitMQ reales (sin mocks).

import { execSync } from "node:child_process";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";

// API HTTP de administración de RabbitMQ (la misma de la consola web del puerto 15672).
const RABBITMQ_API = process.env.RABBITMQ_API ?? "http://localhost:15672";
const RABBITMQ_USER = process.env.RABBITMQ_USER ?? "guest";
const RABBITMQ_PASSWORD = process.env.RABBITMQ_PASSWORD ?? "guest";

export const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function api(ruta, { method = "GET", body, token } = {}) {
    const headers = {};

    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${BASE_URL}${ruta}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    const esJson = (response.headers.get("content-type") ?? "").includes("application/json");

    return {
        status: response.status,
        headers: response.headers,
        body: esJson ? await response.json() : await response.text()
    };
}

// Crea un usuario nuevo con email y DNI únicos.
export async function crearUsuario(prefijo) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const usuario = {
        nombre: "E2E",
        apellido: prefijo,
        dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
        telefono: "3794 111111",
        email: `${prefijo}-${id}@e2e.test`,
        password: "secreta123",
        rol: "CLIENTE"
    };

    const respuesta = await api("/auth/registrar-usuario", { method: "POST", body: usuario });

    if (respuesta.status !== 201) {
        throw new Error(`No se pudo registrar el usuario: ${respuesta.status} ${JSON.stringify(respuesta.body)}`);
    }

    return { ...usuario, id: respuesta.body.id };
}

export function login(email, password) {
    return api("/auth/iniciar-sesion", { method: "POST", body: { email, password } });
}

// Si la IP quedó bloqueada por un test anterior (por ejemplo, el de estrés), espera a que se libere.
export async function esperarDesbloqueo(email, password) {
    for (let intento = 0; intento < 3; intento++) {
        const respuesta = await login(email, password);

        if (respuesta.status !== 429) return;

        const segundos = Number(respuesta.headers.get("retry-after") ?? "60");
        console.log(`  La IP está bloqueada por un test anterior: esperando ${segundos + 1} s...`);
        await esperar((segundos + 1) * 1000);
    }
}

// Lee el valor de una serie de GET /metrics, por ejemplo m1_logins_total{resultado="fallido"}.
export async function leerMetrica(serie) {
    const { body } = await api("/metrics");
    const linea = String(body).split("\n").find((l) => l.startsWith(`${serie} `));

    return linea ? Number(linea.split(" ")[1]) : 0;
}

// Repite una comprobación hasta que se cumpla o se termine el tiempo.
export async function esperarHasta(descripcion, comprobar, { segundos = 30, cada = 1000 } = {}) {
    const limite = Date.now() + segundos * 1000;

    while (Date.now() < limite) {
        if (await comprobar()) return;
        await esperar(cada);
    }

    throw new Error(`No se cumplió en ${segundos} s: ${descripcion}`);
}

async function rabbitApi(ruta, method = "GET", body) {
    const response = await fetch(`${RABBITMQ_API}/api${ruta}`, {
        method,
        headers: {
            Authorization: `Basic ${Buffer.from(`${RABBITMQ_USER}:${RABBITMQ_PASSWORD}`).toString("base64")}`,
            "Content-Type": "application/json"
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`RabbitMQ API ${method} ${ruta}: ${response.status} ${await response.text()}`);
    }

    return response.status === 204 ? null : response.json().catch(() => null);
}

// Crea una cola temporal de prueba enlazada al exchange de M1, para ver los eventos que publica.
export async function crearColaDePrueba(nombre) {
    // Mismo tipo y durabilidad que declara M1: si ya existe, no cambia nada.
    await rabbitApi("/exchanges/%2F/m1.eventos", "PUT", { type: "topic", durable: true });
    await rabbitApi(`/queues/%2F/${nombre}`, "PUT", { durable: false, auto_delete: false });
    await rabbitApi(`/bindings/%2F/e/m1.eventos/q/${nombre}`, "POST", { routing_key: "auth.#" });
}

export async function leerEventos(nombre) {
    const mensajes = await rabbitApi(`/queues/%2F/${nombre}/get`, "POST", {
        count: 100,
        ackmode: "ack_requeue_false",
        encoding: "auto"
    });

    return mensajes.map((m) => JSON.parse(m.payload));
}

export async function borrarCola(nombre) {
    await rabbitApi(`/queues/%2F/${nombre}`, "DELETE").catch(() => {});
}

// Nombres de los contenedores en docker-compose.yml (container_name).
const CONTENEDORES = { redis: "m1-redis", rabbitmq: "m1-rabbitmq" };

// Apaga o prende el contenedor de Redis o RabbitMQ con "docker stop" / "docker start".
// Se puede reemplazar el comando con E2E_STOP_REDIS, E2E_START_REDIS, E2E_STOP_RABBITMQ y E2E_START_RABBITMQ.
export function controlarServicio(accion, servicio) {
    const variable = `E2E_${accion.toUpperCase()}_${servicio.toUpperCase()}`;
    const comando = process.env[variable] ?? `docker ${accion} ${CONTENEDORES[servicio]}`;

    console.log(`  > ${comando}`);
    execSync(comando, { stdio: "ignore" });
}
