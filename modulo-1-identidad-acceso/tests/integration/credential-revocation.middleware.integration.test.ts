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

describe("RF-1.4 - Control de credenciales revocadas", () => {
    it("Rechazar con 401 un JWT emitido antes de la revocación", async () => {
        await redis.flushall();

        const ahora = Math.floor(Date.now() / 1000);

        const token = jwt.sign(
            { userId: 501, role: "CLIENTE", iat: ahora - 120 },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        await redis.set("revocacion:usuario:501", String(ahora - 60));

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(401);
        expect(response.body.valid).toBe(false);
        expect(response.body.error).toBe("Credencial revocada");
    });

    it("Dejar pasar un JWT emitido después de la revocación", async () => {
        await redis.flushall();

        const ahora = Math.floor(Date.now() / 1000);

        const token = jwt.sign(
            { userId: 502, role: "CONDUCTOR", iat: ahora - 30 },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        await redis.set("revocacion:usuario:502", String(ahora - 60));

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.userId).toBe(502);
    });

    it("No afectar a los usuarios que no revocaron nada", async () => {
        await redis.flushall();

        const ahora = Math.floor(Date.now() / 1000);

        const token = jwt.sign(
            { userId: 503, role: "CLIENTE", iat: ahora - 120 },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        await redis.set("revocacion:usuario:999", String(ahora - 60));

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
    });

    it("Dejar que las rutas sin token sigan funcionando igual", async () => {
        const sinToken = await request(app)
            .get("/auth/validar-identidad-y-rol");

        const tokenInvalido = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", "Bearer invalid.token.here");

        expect(sinToken.status).toBe(401);
        expect(sinToken.body.error).toBe("Token requerido");
        expect(tokenInvalido.status).toBe(401);
        expect(tokenInvalido.body.error).toBe("Token inválido");
    });

    it("Dejar pasar el pedido si Redis está caído", async () => {
        const ahora = Math.floor(Date.now() / 1000);

        const token = jwt.sign(
            { userId: 504, role: "CLIENTE", iat: ahora - 120 },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        const get = vi
            .spyOn(redis, "get")
            .mockRejectedValue(new Error("Redis caído"));
        const errores = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        get.mockRestore();
        errores.mockRestore();

        expect(response.status).toBe(200);
    });
});
