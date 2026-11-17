// AE4 - Test end-to-end de RF-1.4 (recuperación y revocación) contra M1, Redis y RabbitMQ reales.
// Correr con: npm run test:e2e:rf14  (M1, Redis y RabbitMQ tienen que estar levantados)

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
    api,
    borrarCola,
    crearColaDePrueba,
    crearUsuario,
    esperar,
    esperarDesbloqueo,
    esperarHasta,
    leerEventos,
    leerMetrica,
    login
} from "./helpers-ae4.mjs";

const COLA = `e2e-rf14-${Date.now()}`;
const NUEVA_PASSWORD = "nuevaClave123";

// El JWT guarda en "iat" el segundo en que se emitió. Un token se rechaza si es de un segundo
// anterior a la revocación, así que entre emitir y revocar se espera un poco más de 1 s.
const UN_SEGUNDO = 1100;

const serie = (operacion, resultado) =>
    `m1_credenciales_total{operacion="${operacion}",resultado="${resultado}"}`;
const serieEvento = (evento, resultado) =>
    `m1_eventos_credenciales_total{evento="${evento}",resultado="${resultado}"}`;

let usuario;
let tokenAntesDelReseteo;
let tokenDeRecuperacion;
let tokenAntesDeRevocar;
let eventos = [];
const metricasAntes = {};

// Lee la cola hasta encontrar el evento del usuario de este test.
async function esperarEvento(nombre, condicion = () => true) {
    await esperarHasta(`llegue ${nombre}`, async () => {
        eventos.push(...(await leerEventos(COLA)));
        return eventos.some((e) => e.evento === nombre && condicion(e));
    }, { segundos: 15 });

    return eventos.find((e) => e.evento === nombre && condicion(e));
}

describe("AE4 - RF-1.4 de punta a punta (M1 + Redis + RabbitMQ reales)", () => {
    before(async () => {
        const health = await api("/health");
        assert.equal(health.status, 200, "M1 no responde en /health: ¿está levantado?");

        usuario = await crearUsuario("rf14");
        await esperarDesbloqueo(usuario.email, usuario.password);
        await crearColaDePrueba(COLA);

        metricasAntes.solicitadaOk = await leerMetrica(serie("recuperacion_solicitada", "ok"));
        metricasAntes.reseteadaOk = await leerMetrica(serie("contrasena_reseteada", "ok"));
        metricasAntes.reseteadaError = await leerMetrica(serie("contrasena_reseteada", "error"));
        metricasAntes.revocadasOk = await leerMetrica(serie("credenciales_revocadas", "ok"));
        metricasAntes.eventoRecuperacion = await leerMetrica(serieEvento("auth.recuperacion_solicitada", "publicado"));
        metricasAntes.eventoRevocacion = await leerMetrica(serieEvento("auth.credenciales_revocadas", "publicado"));
    });

    after(async () => {
        await borrarCola(COLA);
    });

    test("Pedir recuperación responde 200 y el evento llega a RabbitMQ con el token", async () => {
        // Sesión abierta antes de cambiar la contraseña: después del reseteo tiene que dejar de servir.
        const sesion = await login(usuario.email, usuario.password);
        assert.equal(sesion.status, 200);
        tokenAntesDelReseteo = sesion.body.token;

        const respuesta = await api("/auth/solicitar-recuperacion", {
            method: "POST",
            body: { email: usuario.email }
        });
        assert.equal(respuesta.status, 200);

        const evento = await esperarEvento(
            "auth.recuperacion_solicitada",
            (e) => e.datos.email === usuario.email
        );

        assert.equal(evento.modulo, "M1");
        assert.equal(evento.datos.userId, usuario.id);
        assert.equal(evento.datos.expiraEnSegundos, 900);
        assert.equal(evento.datos.token.length, 64);
        tokenDeRecuperacion = evento.datos.token;
    });

    test("Resetear con el token del evento cambia la contraseña", async () => {
        await esperar(UN_SEGUNDO);

        const respuesta = await api("/auth/resetear-contrasena", {
            method: "POST",
            body: { token: tokenDeRecuperacion, newPassword: NUEVA_PASSWORD }
        });

        assert.equal(respuesta.status, 200);
    });

    test("Con la contraseña nueva se inicia sesión y con la vieja no", async () => {
        const nueva = await login(usuario.email, NUEVA_PASSWORD);
        assert.equal(nueva.status, 200);
        assert.ok(nueva.body.token, "falta el token");

        const me = await api("/auth/me", { token: nueva.body.token });
        assert.equal(me.status, 200);
        assert.equal(me.body.email, usuario.email);

        const vieja = await login(usuario.email, usuario.password);
        assert.equal(vieja.status, 401);
    });

    test("La sesión abierta antes del reseteo queda revocada (401)", async () => {
        const respuesta = await api("/auth/me", { token: tokenAntesDelReseteo });

        assert.equal(respuesta.status, 401);
        assert.equal(respuesta.body.error, "Credencial revocada");
    });

    test("El token de recuperación sirve una sola vez", async () => {
        const respuesta = await api("/auth/resetear-contrasena", {
            method: "POST",
            body: { token: tokenDeRecuperacion, newPassword: "otraClave456" }
        });

        assert.equal(respuesta.status, 401);
    });

    test("El reseteo publica auth.credenciales_revocadas con motivo CAMBIO_DE_CONTRASENA", async () => {
        const evento = await esperarEvento(
            "auth.credenciales_revocadas",
            (e) => e.datos.userId === usuario.id && e.datos.motivo === "CAMBIO_DE_CONTRASENA"
        );

        assert.equal(evento.modulo, "M1");
        assert.ok(evento.datos.revocadasDesde > 0);
    });

    test("Revocar credenciales: el token viejo da 401 también para los otros módulos", async () => {
        const sesion = await login(usuario.email, NUEVA_PASSWORD);
        assert.equal(sesion.status, 200);
        tokenAntesDeRevocar = sesion.body.token;

        await esperar(UN_SEGUNDO);

        const revocar = await api("/auth/revocar-credenciales", {
            method: "POST",
            token: tokenAntesDeRevocar
        });
        assert.equal(revocar.status, 200);

        const me = await api("/auth/me", { token: tokenAntesDeRevocar });
        assert.equal(me.status, 401);
        assert.equal(me.body.error, "Credencial revocada");

        // Lo mismo que vería otro módulo al validar el token.
        const validar = await api("/auth/validar-identidad-y-rol", { token: tokenAntesDeRevocar });
        assert.equal(validar.status, 401);
        assert.equal(validar.body.valid, false);
    });

    test("La revocación publica auth.credenciales_revocadas con motivo SOLICITUD_DEL_USUARIO", async () => {
        const evento = await esperarEvento(
            "auth.credenciales_revocadas",
            (e) => e.datos.userId === usuario.id && e.datos.motivo === "SOLICITUD_DEL_USUARIO"
        );

        assert.equal(evento.modulo, "M1");
    });

    test("Después de revocar, un login nuevo vuelve a funcionar", async () => {
        await esperar(UN_SEGUNDO);

        const sesion = await login(usuario.email, NUEVA_PASSWORD);
        assert.equal(sesion.status, 200);

        const me = await api("/auth/me", { token: sesion.body.token });
        assert.equal(me.status, 200);
    });

    test("Las métricas de RF-1.4 reflejan exactamente lo que pasó", async () => {
        assert.equal(await leerMetrica(serie("recuperacion_solicitada", "ok")), metricasAntes.solicitadaOk + 1);
        assert.equal(await leerMetrica(serie("contrasena_reseteada", "ok")), metricasAntes.reseteadaOk + 1);
        assert.equal(await leerMetrica(serie("contrasena_reseteada", "error")), metricasAntes.reseteadaError + 1);
        assert.equal(await leerMetrica(serie("credenciales_revocadas", "ok")), metricasAntes.revocadasOk + 1);

        // Un evento de recuperación y dos de revocación (el del reseteo y el pedido por el usuario).
        assert.equal(
            await leerMetrica(serieEvento("auth.recuperacion_solicitada", "publicado")),
            metricasAntes.eventoRecuperacion + 1
        );
        assert.equal(
            await leerMetrica(serieEvento("auth.credenciales_revocadas", "publicado")),
            metricasAntes.eventoRevocacion + 2
        );
    });
});
