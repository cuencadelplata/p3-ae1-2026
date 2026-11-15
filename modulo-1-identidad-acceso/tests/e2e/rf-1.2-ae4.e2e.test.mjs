// AE4 - Test end-to-end de RF-1.2 contra M1, Redis y RabbitMQ reales.
// Correr con: npm run test:e2e:ae4  (M1, Redis y RabbitMQ tienen que estar levantados)

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
    api,
    borrarCola,
    crearColaDePrueba,
    crearUsuario,
    esperarDesbloqueo,
    esperarHasta,
    leerEventos,
    leerMetrica,
    login
} from "./helpers-ae4.mjs";

const COLA = `e2e-ae4-${Date.now()}`;
const MAX_INTENTOS = Number(process.env.LOGIN_MAX_INTENTOS ?? "5");

let usuario;
let token;

describe("AE4 - RF-1.2 de punta a punta (M1 + Redis + RabbitMQ reales)", () => {
    before(async () => {
        const health = await api("/health");
        assert.equal(health.status, 200, "M1 no responde en /health: ¿está levantado?");

        usuario = await crearUsuario("rf12");
        await esperarDesbloqueo(usuario.email, usuario.password);
        await crearColaDePrueba(COLA);
    });

    after(async () => {
        await borrarCola(COLA);
    });

    test("Login correcto devuelve 200 con token", async () => {
        const respuesta = await login(usuario.email, usuario.password);

        assert.equal(respuesta.status, 200);
        assert.ok(respuesta.body.token, "falta el token");
        token = respuesta.body.token;
    });

    test("GET /auth/me devuelve los datos del dueño del token, sin la contraseña", async () => {
        const respuesta = await api("/auth/me", { token });

        assert.equal(respuesta.status, 200);
        assert.equal(respuesta.body.userId, usuario.id);
        assert.equal(respuesta.body.email, usuario.email);
        assert.equal(respuesta.body.dni, usuario.dni);
        assert.equal(respuesta.body.password, undefined);
        assert.equal(respuesta.body.password_hash, undefined);
    });

    test("El evento auth.login_exitoso llega a RabbitMQ", async () => {
        let eventos = [];

        await esperarHasta("llegue auth.login_exitoso", async () => {
            eventos.push(...(await leerEventos(COLA)));
            return eventos.some((e) => e.evento === "auth.login_exitoso" && e.datos.userId === usuario.id);
        }, { segundos: 15 });

        const evento = eventos.find((e) => e.evento === "auth.login_exitoso" && e.datos.userId === usuario.id);
        assert.equal(evento.modulo, "M1");
        assert.equal(evento.datos.role, "CLIENTE");
    });

    test(`Después de ${MAX_INTENTOS} fallos responde 429 con Retry-After (Redis real)`, async () => {
        const fallidosAntes = await leerMetrica('m1_logins_total{resultado="fallido"}');
        const bloqueadosAntes = await leerMetrica('m1_logins_total{resultado="bloqueado"}');
        const ipsAntes = await leerMetrica("m1_ips_bloqueadas_total");

        for (let i = 0; i < MAX_INTENTOS; i++) {
            const respuesta = await login(usuario.email, "incorrecta");
            assert.equal(respuesta.status, 401, `el intento ${i + 1} tendría que dar 401`);
        }

        const bloqueado = await login(usuario.email, "incorrecta");
        assert.equal(bloqueado.status, 429);
        assert.ok(Number(bloqueado.headers.get("retry-after")) > 0, "falta el header Retry-After");

        // Con la IP bloqueada, ni la contraseña correcta pasa.
        const correcta = await login(usuario.email, usuario.password);
        assert.equal(correcta.status, 429);

        // Las métricas reflejan exactamente lo que pasó.
        assert.equal(await leerMetrica('m1_logins_total{resultado="fallido"}'), fallidosAntes + MAX_INTENTOS);
        assert.equal(await leerMetrica('m1_logins_total{resultado="bloqueado"}'), bloqueadosAntes + 2);
        assert.equal(await leerMetrica("m1_ips_bloqueadas_total"), ipsAntes + 1);
    });

    test("El evento auth.ip_bloqueada llega a RabbitMQ con los intentos", async () => {
        let eventos = [];

        await esperarHasta("llegue auth.ip_bloqueada", async () => {
            eventos.push(...(await leerEventos(COLA)));
            return eventos.some((e) => e.evento === "auth.ip_bloqueada");
        }, { segundos: 15 });

        const evento = eventos.find((e) => e.evento === "auth.ip_bloqueada");
        assert.equal(evento.datos.intentos, MAX_INTENTOS);
        assert.ok(evento.datos.bloqueadaPorSegundos > 0);
    });

    test("Redis y RabbitMQ figuran conectados en /metrics", async () => {
        assert.equal(await leerMetrica('m1_dependencia_disponible{dependencia="redis"}'), 1);
        assert.equal(await leerMetrica('m1_dependencia_disponible{dependencia="rabbitmq"}'), 1);
    });
});
