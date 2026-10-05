import request from "supertest";
import jwt from "jsonwebtoken";
import {
    describe,
    expect,
    it,
    vi
} from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";

describe("RF-1.4 - POST /auth/revocar-credenciales", () => {
    it("Pedir autenticación para revocar", async () => {
        const response = await request(app)
            .post("/auth/revocar-credenciales");

        expect(response.status).toBe(401);
        expect(response.body.error).toBe("Token requerido");
    });

    it("Revocar las credenciales del usuario y avisar por RabbitMQ", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const ahora = Math.floor(Date.now() / 1000);

        const token = jwt.sign(
            { userId: 601, role: "CLIENTE", iat: ahora - 120 },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        const response = await request(app)
            .post("/auth/revocar-credenciales")
            .set("Authorization", `Bearer ${token}`);

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const mensaje = (globalThis as any).__mensajesRabbit[0];

        expect(response.status).toBe(200);
        expect(response.body.userId).toBe(601);
        expect(response.body.revocadasDesde).toBeGreaterThanOrEqual(ahora);
        expect(mensaje.routingKey).toBe("auth.credenciales_revocadas");
        expect(mensaje.contenido.datos.userId).toBe(601);
        expect(mensaje.contenido.datos.motivo).toBe("SOLICITUD_DEL_USUARIO");
    });

    it("Dejar sin efecto el mismo token después de revocar", async () => {
        await redis.flushall();

        const ahora = Math.floor(Date.now() / 1000);

        const token = jwt.sign(
            { userId: 602, role: "CONDUCTOR", iat: ahora - 120 },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        const antes = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        await request(app)
            .post("/auth/revocar-credenciales")
            .set("Authorization", `Bearer ${token}`);

        const despues = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        const segundaRevocacion = await request(app)
            .post("/auth/revocar-credenciales")
            .set("Authorization", `Bearer ${token}`);

        expect(antes.status).toBe(200);
        expect(despues.status).toBe(401);
        expect(despues.body.error).toBe("Credencial revocada");
        expect(segundaRevocacion.status).toBe(401);
    });

    it("Permitir volver a entrar con un login nuevo después de revocar", async () => {
        await redis.flushall();

        const email = `revocacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Revocación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        const primerLogin = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password: "123456" });

        await request(app)
            .post("/auth/revocar-credenciales")
            .set("Authorization", `Bearer ${primerLogin.body.token}`);

        const segundoLogin = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password: "123456" });

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${segundoLogin.body.token}`);

        expect(segundoLogin.status).toBe(200);
        expect(response.status).toBe(200);
    });

    it("Responder 503 si Redis está caído y no se puede guardar la revocación", async () => {
        const ahora = Math.floor(Date.now() / 1000);

        const token = jwt.sign(
            { userId: 603, role: "CLIENTE", iat: ahora - 120 },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        const set = vi
            .spyOn(redis, "set")
            .mockRejectedValue(new Error("Redis caído"));
        const errores = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        const response = await request(app)
            .post("/auth/revocar-credenciales")
            .set("Authorization", `Bearer ${token}`);

        set.mockRestore();
        errores.mockRestore();

        expect(response.status).toBe(503);
    });
});
