// AE4 - Apagar y prender Redis y RabbitMQ: M1 no se cae y se recupera solo.
// Correr con: npm run test:e2e:resiliencia
// Apaga y prende los contenedores m1-redis y m1-rabbitmq con "docker stop/start".

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
    api,
    controlarServicio,
    crearUsuario,
    esperarDesbloqueo,
    esperarHasta,
    leerMetrica,
    login
} from "./helpers-ae4.mjs";

const EVENTO_OK = 'm1_eventos_publicados_total{evento="auth.login_exitoso",resultado="ok"}';
const EVENTO_ERROR = 'm1_eventos_publicados_total{evento="auth.login_exitoso",resultado="error"}';

let usuario;

describe("AE4 - Resiliencia: apagar y prender Redis y RabbitMQ", () => {
    before(async () => {
        usuario = await crearUsuario("resiliencia");
        await esperarDesbloqueo(usuario.email, usuario.password);
    });

    // Pase lo que pase en los tests, deja Redis y RabbitMQ prendidos.
    after(() => {
        try { controlarServicio("start", "redis"); } catch { /* ya estaba prendido */ }
        try { controlarServicio("start", "rabbitmq"); } catch { /* ya estaba prendido */ }
    });

    test("Con Redis apagado, M1 sigue respondiendo y el login funciona (fail-open)", async () => {
        controlarServicio("stop", "redis");

        await esperarHasta("la métrica de Redis pase a 0", async () =>
            (await leerMetrica('m1_dependencia_disponible{dependencia="redis"}')) === 0
        , { segundos: 15 });

        assert.equal((await api("/health")).status, 200);

        const respuesta = await login(usuario.email, usuario.password);
        assert.equal(respuesta.status, 200);

        const me = await api("/auth/me", { token: respuesta.body.token });
        assert.equal(me.status, 200);
    });

    test("Al prender Redis, M1 se reconecta solo, sin reiniciarse", async () => {
        controlarServicio("start", "redis");

        await esperarHasta("la métrica de Redis vuelva a 1", async () =>
            (await leerMetrica('m1_dependencia_disponible{dependencia="redis"}')) === 1
        , { segundos: 60 });

        assert.equal((await login(usuario.email, usuario.password)).status, 200);
    });

    test("Con RabbitMQ apagado, el login funciona y el evento se cuenta como error", async () => {
        controlarServicio("stop", "rabbitmq");

        const erroresAntes = await leerMetrica(EVENTO_ERROR);

        // Puede tardar unos segundos en notar que RabbitMQ se cayó.
        await esperarHasta("un evento falle por RabbitMQ caído", async () => {
            const respuesta = await login(usuario.email, usuario.password);
            assert.equal(respuesta.status, 200, "el login no tiene que fallar por RabbitMQ");
            await new Promise((r) => setTimeout(r, 300));
            return (await leerMetrica(EVENTO_ERROR)) > erroresAntes;
        }, { segundos: 30, cada: 2000 });

        assert.equal(await leerMetrica('m1_dependencia_disponible{dependencia="rabbitmq"}'), 0);
        assert.equal((await api("/health")).status, 200);
    });

    test("Al prender RabbitMQ, M1 vuelve a publicar eventos solo", async () => {
        controlarServicio("start", "rabbitmq");

        const okAntes = await leerMetrica(EVENTO_OK);

        // M1 reintenta la conexión cada 10 s; RabbitMQ tarda en arrancar.
        await esperarHasta("se publique un evento ok", async () => {
            assert.equal((await login(usuario.email, usuario.password)).status, 200);
            await new Promise((r) => setTimeout(r, 300));
            return (await leerMetrica(EVENTO_OK)) > okAntes;
        }, { segundos: 90, cada: 3000 });

        assert.equal(await leerMetrica('m1_dependencia_disponible{dependencia="rabbitmq"}'), 1);
    });
});
