import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";

const TEST_API_KEY = "clave-interna-test-m1-m8";
const ORIGINAL_API_KEY = process.env.M1_INTERNAL_API_KEY;

let userId = 0;

describe("GET /auth/usuarios/:id/nombre (consulta interna entre servicios)", () => {
    beforeAll(async () => {
        await redis.flushall();
        process.env.M1_INTERNAL_API_KEY = TEST_API_KEY;

        const registro = await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Carlos",
                apellido: "Ramirez",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "3794 555555",
                email: `interno-nombre-${Date.now()}@test.com`,
                password: "password123",
                rol: "CONDUCTOR"
            });

        expect(registro.status).toBe(201);
        userId = registro.body.id;
    });

    afterAll(() => {
        if (ORIGINAL_API_KEY === undefined) {
            delete process.env.M1_INTERNAL_API_KEY;
        } else {
            process.env.M1_INTERNAL_API_KEY = ORIGINAL_API_KEY;
        }
    });

    it("Devuelve 200 con únicamente { userId, nombre, apellido } cuando la clave interna es válida", async () => {
        const res = await request(app)
            .get(`/auth/usuarios/${userId}/nombre`)
            .set("X-Internal-Api-Key", TEST_API_KEY);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            userId,
            nombre: "Carlos",
            apellido: "Ramirez"
        });
        expect(typeof res.body.userId).toBe("number");
        expect(Object.keys(res.body).sort()).toEqual(["apellido", "nombre", "userId"]);
    });

    it("Devuelve 404 si el usuario no existe", async () => {
        const res = await request(app)
            .get("/auth/usuarios/999999999/nombre")
            .set("X-Internal-Api-Key", TEST_API_KEY);

        expect(res.status).toBe(404);
    });

    it("Devuelve 400 si el id no es un entero positivo", async () => {
        const res = await request(app)
            .get("/auth/usuarios/abc/nombre")
            .set("X-Internal-Api-Key", TEST_API_KEY);

        expect(res.status).toBe(400);
    });

    it("Devuelve 401 si falta X-Internal-Api-Key o es incorrecta", async () => {
        const sinHeader = await request(app).get(`/auth/usuarios/${userId}/nombre`);
        expect(sinHeader.status).toBe(401);

        const claveMal = await request(app)
            .get(`/auth/usuarios/${userId}/nombre`)
            .set("X-Internal-Api-Key", "otra-clave-distinta");
        expect(claveMal.status).toBe(401);
    });

    it("Devuelve 503 si M1_INTERNAL_API_KEY no está configurada en el servidor", async () => {
        const prev = process.env.M1_INTERNAL_API_KEY;
        delete process.env.M1_INTERNAL_API_KEY;

        const res = await request(app)
            .get(`/auth/usuarios/${userId}/nombre`)
            .set("X-Internal-Api-Key", TEST_API_KEY);

        process.env.M1_INTERNAL_API_KEY = prev;
        expect(res.status).toBe(503);
    });
});
