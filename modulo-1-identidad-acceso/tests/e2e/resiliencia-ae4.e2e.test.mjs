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

const RABBITMQ_CONECTADO = 'm1_dependencia_disponible{dependencia="rabbitmq"}';

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

    test("Con RabbitMQ apagado, el login sigue funcionando", async () => {
        controlarServicio("stop", "rabbitmq");

        // Cada login intenta publicar su evento; M1 nota que RabbitMQ se cayó y la métrica pasa a 0.
        await esperarHasta("la métrica de RabbitMQ pase a 0", async () => {
            const respuesta = await login(usuario.email, usuario.password);
            assert.equal(respuesta.status, 200, "el login no tiene que fallar por RabbitMQ");
            return (await leerMetrica(RABBITMQ_CONECTADO)) === 0;
        }, { segundos: 30, cada: 2000 });

        assert.equal((await api("/health")).status, 200);
    });

    test("Al prender RabbitMQ, M1 se reconecta solo al publicar el siguiente evento", async () => {
        controlarServicio("start", "rabbitmq");

        // M1 reintenta la conexión cada 10 s; RabbitMQ tarda en arrancar.
        await esperarHasta("la métrica de RabbitMQ vuelva a 1", async () => {
            assert.equal((await login(usuario.email, usuario.password)).status, 200);
            await new Promise((r) => setTimeout(r, 300));
            return (await leerMetrica(RABBITMQ_CONECTADO)) === 1;
        }, { segundos: 90, cada: 3000 });
    });
});
