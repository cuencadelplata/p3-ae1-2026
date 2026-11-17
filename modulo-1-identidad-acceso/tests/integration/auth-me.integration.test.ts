import request from "supertest";
import {
    beforeAll,
    describe,
    expect,
    it
} from "vitest";

import app from "../../src/app";
import db from "../../src/config/database";
import redis from "../../src/config/redis";

const password = "123456";

function datosDeRegistro(email: string) {
    return {
        nombre: "Perfil",
        apellido: "Propio",
        // DNI distinto en cada corrida: M1 no permite registrar dos usuarios con el mismo DNI.
        dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
        telefono: "11 5555 1234",
        email,
        password,
        rol: "CONDUCTOR"
    };
}

async function registrarYLoguear(email: string) {
    const registro = await request(app)
        .post("/auth/registrar-usuario")
        .send(datosDeRegistro(email));

    expect(registro.status).toBe(201);

    const login = await request(app)
        .post("/auth/iniciar-sesion")
        .send({ email, password });

    expect(login.status).toBe(200);

    return {
        token: login.body.token as string,
        usuario: login.body.usuario
    };
}

describe.sequential(
    "RF-1.2 - GET /auth/me",
    () => {
        beforeAll(async () => {
            await redis.flushall();
        });

        it("Devolver los datos del usuario dueño del token", async () => {
            const email = `me-${Date.now()}@test.com`;
            const { token, usuario } = await registrarYLoguear(email);

            const response = await request(app)
                .get("/auth/me")
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.userId).toBe(usuario.id);
            expect(response.body.email).toBe(email);
            expect(response.body.nombre).toBe("Perfil");
            expect(response.body.telefono).toBe("11 5555 1234");
            expect(response.body.rol).toBe("CONDUCTOR");
            expect(response.body.estado).toBe("ACTIVO");
        });

        it("No devolver nunca la contraseña", async () => {
            const { token } = await registrarYLoguear(`me-pass-${Date.now()}@test.com`);

            const response = await request(app)
                .get("/auth/me")
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.password_hash).toBeUndefined();
            expect(response.body.password).toBeUndefined();
        });

        it("Cada usuario ve solo sus propios datos", async () => {
            const a = await registrarYLoguear(`me-a-${Date.now()}@test.com`);
            const b = await registrarYLoguear(`me-b-${Date.now()}@test.com`);

            const response = await request(app)
                .get("/auth/me")
                .set("Authorization", `Bearer ${b.token}`);

            expect(response.body.userId).toBe(b.usuario.id);
            expect(response.body.userId).not.toBe(a.usuario.id);
        });

        it("Rechazar sin token (401)", async () => {
            const response = await request(app).get("/auth/me");

            expect(response.status).toBe(401);
        });

        it("Rechazar un token inválido (401)", async () => {
            const response = await request(app)
                .get("/auth/me")
                .set("Authorization", "Bearer token-trucho");

            expect(response.status).toBe(401);
        });

        it("Rechazar a un usuario bloqueado aunque su token siga vigente (403)", async () => {
            const { token, usuario } = await registrarYLoguear(`me-bloq-${Date.now()}@test.com`);

            // Simula un bloqueo hecho por un operador después de que el usuario inició sesión.
            db.prepare("UPDATE usuarios SET estado = 'BLOQUEADO' WHERE id = ?").run(usuario.id);

            const response = await request(app)
                .get("/auth/me")
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(403);
            expect(response.body.error).toBe("Usuario bloqueado");
        });
    }
);
