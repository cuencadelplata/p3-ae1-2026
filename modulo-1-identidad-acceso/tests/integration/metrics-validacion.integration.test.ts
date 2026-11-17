import request from "supertest";
import jwt from "jsonwebtoken";
import {
    beforeAll,
    describe,
    expect,
    it
} from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";
import { getJwtSecret } from "../../src/config/env";
import db from "../../src/config/database";

const email = `validacion-${Date.now()}@test.com`;
const password = "123456";
const dni = String(10_000_000 + Math.floor(Math.random() * 89_999_999));

let token = "";
let userId = 0;

async function leerMetrica(serie: string): Promise<number> {
    const response = await request(app).get("/metrics");
    const linea = response.text.split("\n").find((l) => l.startsWith(`${serie} `));

    return linea ? Number(linea.split(" ")[1]) : 0;
}

const serie = (resultado: string) =>
    `m1_validaciones_identidad_total{resultado="${resultado}"}`;

describe.sequential("AE4 - Métrica RF-1.3: m1_validaciones_identidad_total", () => {
    beforeAll(async () => {
        await redis.flushall();

        const registro = await request(app)
            .post("/auth/registrar-usuario")
            .send({ nombre: "Valida", apellido: "Ción", dni, telefono: "11 5555 1234", email, password, rol: "CONDUCTOR" });
        expect(registro.status).toBe(201);
        userId = registro.body.id;

        const login = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password });
        expect(login.status).toBe(200);
        token = login.body.token;
    });

    it("Contar una validación válida", async () => {
        const antes = await leerMetrica(serie("valida"));

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        expect(response.body.valid).toBe(true);
        expect(await leerMetrica(serie("valida"))).toBe(antes + 1);
    });

    it("Contar los tokens rechazados (sin token y token inválido)", async () => {
        const antes = await leerMetrica(serie("token_rechazado"));

        await request(app).get("/auth/validar-identidad-y-rol").expect(401);
        await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", "Bearer abc.def.ghi")
            .expect(401);

        expect(await leerMetrica(serie("token_rechazado"))).toBe(antes + 2);
    });

    it("Contar un usuario bloqueado", async () => {
        const antes = await leerMetrica(serie("usuario_bloqueado"));

        db.prepare("UPDATE usuarios SET estado = 'BLOQUEADO' WHERE id = ?").run(userId);

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        db.prepare("UPDATE usuarios SET estado = 'ACTIVO' WHERE id = ?").run(userId);

        expect(response.body.valid).toBe(false);
        expect(await leerMetrica(serie("usuario_bloqueado"))).toBe(antes + 1);
    });

    it("Contar un usuario que ya no existe", async () => {
        const antes = await leerMetrica(serie("usuario_inexistente"));

        const tokenFantasma = jwt.sign(
            { userId: 999_999_999, role: "CLIENTE" },
            getJwtSecret(),
            { algorithm: "HS256", expiresIn: "1h" }
        );

        const response = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${tokenFantasma}`);

        expect(response.body.valid).toBe(false);
        expect(await leerMetrica(serie("usuario_inexistente"))).toBe(antes + 1);
    });
});
