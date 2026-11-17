// AE4 - Test de estrés de M1 con k6.
//
// Fase 1 "carga": cada vez más usuarios hacen login correcto y piden GET /auth/me.
// Fase 2 "ataque": muchos intentos con contraseña incorrecta; el rate limit (RF-1.2) tiene que frenarlos con 429.
//
// Ejecutar (ver tests/stress/README.md):
//   docker run --rm -v "%cd%\tests\stress:/scripts" -e BASE_URL=http://host.docker.internal:3001 grafana/k6:1.8.3 run /scripts/login-stress.k6.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const JSON_HEADERS = { "Content-Type": "application/json" };

// Métricas propias del test, además de las que k6 calcula solo.
const duracionLogin = new Trend("m1_duracion_login", true);
const duracionMe = new Trend("m1_duracion_me", true);
const ataqueBloqueado = new Counter("m1_ataque_respuestas_429");
const ataqueNoBloqueado = new Counter("m1_ataque_respuestas_401");

export const options = {
    scenarios: {
        carga: {
            executor: "ramping-vus",
            exec: "cargaNormal",
            startVUs: 0,
            stages: [
                { duration: "20s", target: 10 },   // sube a 10 usuarios a la vez
                { duration: "30s", target: 30 },   // sube a 30
                { duration: "30s", target: 30 },   // se mantiene en 30
                { duration: "10s", target: 0 }     // baja
            ]
        },
        ataque: {
            executor: "constant-vus",
            exec: "fuerzaBruta",
            vus: 10,
            duration: "30s",
            startTime: "95s"                        // empieza cuando termina la carga
        }
    },
    thresholds: {
        // En la carga normal: ningún error, el 95 % de los logins en menos de 3 s
        // y el 95 % de /auth/me en menos de 1,5 s (espera detrás del bcrypt de los logins, ver README).
        "checks{scenario:carga}": ["rate>0.99"],
        "http_req_duration{scenario:carga,endpoint:login}": ["p(95)<3000"],
        "http_req_duration{scenario:carga,endpoint:me}": ["p(95)<1500"],
        // En el ataque, la mayoría de los intentos tienen que terminar bloqueados (429).
        "checks{scenario:ataque}": ["rate>0.99"],
        "m1_ataque_respuestas_429": ["count>0"]
    }
};

// Se ejecuta una sola vez antes del test: crea el usuario con el que se loguean todos.
export function setup() {
    const sufijo = Date.now();
    const usuario = {
        nombre: "Estres",
        apellido: "K6",
        dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
        telefono: "3794 000000",
        email: `estres-${sufijo}@k6.test`,
        password: "secreta123",
        rol: "CLIENTE"
    };

    const respuesta = http.post(
        `${BASE_URL}/auth/registrar-usuario`,
        JSON.stringify(usuario),
        { headers: JSON_HEADERS }
    );

    if (respuesta.status !== 201) {
        throw new Error(`No se pudo registrar el usuario de prueba: ${respuesta.status} ${respuesta.body}`);
    }

    return { email: usuario.email, password: usuario.password };
}

// Fase 1: login correcto + GET /auth/me con el token.
export function cargaNormal(datos) {
    const login = http.post(
        `${BASE_URL}/auth/iniciar-sesion`,
        JSON.stringify({ email: datos.email, password: datos.password }),
        { headers: JSON_HEADERS, tags: { endpoint: "login" } }
    );

    duracionLogin.add(login.timings.duration);

    const loginOk = check(login, {
        "login responde 200": (r) => r.status === 200,
        "login devuelve token": (r) => Boolean(r.json("token"))
    });

    if (!loginOk) {
        sleep(1);
        return;
    }

    const me = http.get(`${BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${login.json("token")}` },
        tags: { endpoint: "me" }
    });

    duracionMe.add(me.timings.duration);

    check(me, {
        "/auth/me responde 200": (r) => r.status === 200,
        "/auth/me no devuelve la contraseña": (r) => !r.body.includes("password")
    });

    sleep(1);
}

// Fase 2: contraseña incorrecta una y otra vez.
export function fuerzaBruta(datos) {
    const respuesta = http.post(
        `${BASE_URL}/auth/iniciar-sesion`,
        JSON.stringify({ email: datos.email, password: "incorrecta" }),
        {
            headers: JSON_HEADERS,
            tags: { endpoint: "login" },
            // 401 y 429 son las respuestas esperadas: no se cuentan como fallas de red.
            responseCallback: http.expectedStatuses(401, 429)
        }
    );

    if (respuesta.status === 429) {
        ataqueBloqueado.add(1);
    } else if (respuesta.status === 401) {
        ataqueNoBloqueado.add(1);
    }

    check(respuesta, {
        "ataque recibe 401 o 429, nunca 200 ni 500": (r) => r.status === 401 || r.status === 429
    });

    sleep(0.2);
}
