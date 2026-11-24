import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";

const OPERADOR_EMAIL = (process.env.M1_OPERADOR_EMAIL || "operador@movilidad.com").trim().toLowerCase();
const OPERADOR_PASSWORD = process.env.M1_OPERADOR_PASSWORD || "operador123";

describe("RF-1.3 - Usuario OPERADOR semilla", () => {
    beforeAll(async () => {
        await redis.flushall();
    });

    it("Permite iniciar sesión al operador semilla, validar su rol y acceder a /auth/admin-panel", async () => {
        const login = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email: OPERADOR_EMAIL, password: OPERADOR_PASSWORD });

        expect(login.status).toBe(200);
        expect(login.body.token).toBeTruthy();
        expect(login.body.usuario.rol).toBe("OPERADOR");

        const validacion = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${login.body.token}`);

        expect(validacion.status).toBe(200);
        expect(validacion.body.valid).toBe(true);
        expect(validacion.body.role).toBe("OPERADOR");

        const adminPanel = await request(app)
            .get("/auth/admin-panel")
            .set("Authorization", `Bearer ${login.body.token}`);

        expect(adminPanel.status).toBe(200);
    });

    it("Sigue impidiendo registrar un OPERADOR desde el endpoint público", async () => {
        const registro = await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Fake",
                apellido: "Admin",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 0000",
                email: `operador-fake-${Date.now()}@test.com`,
                password: "password123",
                rol: "OPERADOR"
            });

        expect(registro.status).toBe(400);
    });
});
