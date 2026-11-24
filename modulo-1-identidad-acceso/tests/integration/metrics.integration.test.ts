import request from "supertest";
import {
    beforeAll,
    describe,
    expect,
    it
} from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";
import { MAX_INTENTOS_FALLIDOS } from "../../src/services/login-attempts.service";

const email = `metricas-${Date.now()}@test.com`;
const password = "123456";
const dni = String(10_000_000 + Math.floor(Math.random() * 89_999_999));

// Lee el valor de una serie del texto de /metrics, por ejemplo m1_logins_total{resultado="exitoso"}.
async function leerMetrica(serie: string): Promise<number> {
    const response = await request(app).get("/metrics");
    const linea = response.text
        .split("\n")
        .find((l) => l.startsWith(`${serie} `));

    return linea ? Number(linea.split(" ")[1]) : 0;
}

describe.sequential("AE4 - Métricas de M1 (GET /metrics)", () => {
    beforeAll(async () => {
        await redis.flushall();

        const response = await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Metricas",
                apellido: "Prueba",
                dni,
                telefono: "11 5555 1234",
                email,
                password,
                rol: "CLIENTE"
            });

        expect(response.status).toBe(201);
    });

    it("Responder 200 en formato de texto de Prometheus", async () => {
        const response = await request(app).get("/metrics");

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("text/plain");
        expect(response.text).toContain("# TYPE m1_logins_total counter");
        expect(response.text).toContain("m1_process_cpu_seconds_total");
    });

    it("Contar un login exitoso", async () => {
        const antes = await leerMetrica('m1_logins_total{resultado="exitoso"}');

        await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password })
            .expect(200);

        const despues = await leerMetrica('m1_logins_total{resultado="exitoso"}');
        expect(despues).toBe(antes + 1);
    });

    it("Contar los fallidos y el 429 del rate limit", async () => {
        await redis.flushall();

        const fallidosAntes = await leerMetrica('m1_logins_total{resultado="fallido"}');
        const bloqueadosAntes = await leerMetrica('m1_logins_total{resultado="bloqueado"}');

        for (let i = 0; i < MAX_INTENTOS_FALLIDOS; i++) {
            await request(app)
                .post("/auth/iniciar-sesion")
                .send({ email, password: "incorrecta" })
                .expect(401);
        }

        await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password: "incorrecta" })
            .expect(429);

        expect(await leerMetrica('m1_logins_total{resultado="fallido"}'))
            .toBe(fallidosAntes + MAX_INTENTOS_FALLIDOS);
        expect(await leerMetrica('m1_logins_total{resultado="bloqueado"}'))
            .toBe(bloqueadosAntes + 1);

        await redis.flushall();
    });

    it("Exponer las 3 métricas del módulo desde el arranque, en 0", async () => {
        const response = await request(app).get("/metrics");

        expect(response.text).toContain('m1_logins_total{resultado="exitoso"}');
        expect(response.text).toContain('m1_validaciones_identidad_total{resultado="valida"}');
        expect(response.text).toContain(
            'm1_credenciales_total{operacion="recuperacion_solicitada",resultado="ok"}'
        );
    });

    it("Medir la duración por ruta, sin una serie por cada id", async () => {
        await request(app).get("/auth/me");

        const response = await request(app).get("/metrics");

        expect(response.text).toContain(
            'm1_http_request_duration_seconds_count{metodo="GET",ruta="/auth/me",codigo="401"}'
        );
    });
});
