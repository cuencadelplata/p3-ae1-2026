import jwt from "jsonwebtoken";
import request from "supertest";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it
} from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";
import {
    findUserByEmail,
    updateUserStatus
} from "../../src/repositories/user.repository";

const CREDENCIAL = "credencial-de-prueba-m9-delegacion";
const PEDIDO = { audience: "m5", scope: "ride-requests:write" };

async function registrar(rol: "CLIENTE" | "CONDUCTOR"): Promise<number> {
    const email = `delegado-${rol.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

    await request(app)
        .post("/auth/registrar-usuario")
        .send({
            nombre: "Ana",
            apellido: "Delegada",
            dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
            telefono: "11 5555 1234",
            email,
            password: "123456",
            rol
        });

    return findUserByEmail(email)!.id;
}

function pedirToken(body: Record<string, unknown>, credencial: string | null = CREDENCIAL) {
    const pedido = request(app).post("/auth/token-delegado").send(body);
    return credencial === null ? pedido : pedido.set("Authorization", `Bearer ${credencial}`);
}

describe("Token delegado para M9 - POST /auth/token-delegado", () => {
    let credencialAnterior: string | undefined;

    beforeAll(() => {
        credencialAnterior = process.env.DELEGACION_M9_CREDENCIAL;
        process.env.DELEGACION_M9_CREDENCIAL = CREDENCIAL;
    });

    afterAll(() => {
        if (credencialAnterior === undefined) {
            delete process.env.DELEGACION_M9_CREDENCIAL;
        } else {
            process.env.DELEGACION_M9_CREDENCIAL = credencialAnterior;
        }
    });

    beforeEach(async () => {
        await redis.flushall();
    });

    it("Emite un token que cumple todo lo que M9 comprueba antes de mandarlo a M5", async () => {
        const clienteId = await registrar("CLIENTE");

        const respuesta = await pedirToken({ clientId: String(clienteId), ...PEDIDO });

        expect(respuesta.status).toBe(200);
        expect(respuesta.headers["cache-control"]).toBe("no-store");
        expect(respuesta.body).toMatchObject({
            token_type: "Bearer",
            expires_in: 300,
            audience: "m5",
            scope: "ride-requests:write"
        });

        const token: string = respuesta.body.access_token;
        const claims = jwt.decode(token) as jwt.JwtPayload;

        // Misma comprobación que matchesSubject() de M9: subject y más de 30 s de vida.
        expect(claims.sub).toBe(String(clienteId));
        expect(claims.userId).toBe(clienteId);
        expect(claims.exp! > Math.floor(Date.now() / 1000) + 30).toBe(true);
        expect(claims.exp! - claims.iat!).toBe(300);
        expect(claims.aud).toBe("m5");
        expect(claims.scope).toBe("ride-requests:write");
        expect(claims.act).toEqual({ sub: "m9-reservas-programadas" });

        // M9 (y M5) validan el token contra M1.
        const validacion = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${token}`);

        expect(validacion.status).toBe(200);
        expect(validacion.body).toMatchObject({
            valid: true,
            userId: clienteId,
            role: "CLIENTE",
            authMethod: "delegated"
        });
    });

    it("Acepta clientId numérico y emite un token distinto por cliente", async () => {
        const primero = await registrar("CLIENTE");
        const segundo = await registrar("CLIENTE");

        const a = await pedirToken({ clientId: primero, ...PEDIDO });
        const b = await pedirToken({ clientId: segundo, ...PEDIDO });

        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect((jwt.decode(a.body.access_token) as jwt.JwtPayload).sub).toBe(String(primero));
        expect((jwt.decode(b.body.access_token) as jwt.JwtPayload).sub).toBe(String(segundo));
    });

    it("Rechaza a quien no presenta la credencial de M9", async () => {
        const clienteId = await registrar("CLIENTE");

        const sinCredencial = await pedirToken({ clientId: String(clienteId), ...PEDIDO }, null);
        const credencialIncorrecta = await pedirToken({ clientId: String(clienteId), ...PEDIDO }, "otra-credencial");

        // Un JWT de pasajero tampoco sirve como credencial de servicio.
        const login = await request(app).post("/auth/iniciar-sesion").send({ email: "nadie@test.com", password: "x" });
        const conJwt = await pedirToken({ clientId: String(clienteId), ...PEDIDO }, login.body.token ?? "un.jwt.cualquiera");

        for (const r of [sinCredencial, credencialIncorrecta, conJwt]) {
            expect(r.status).toBe(401);
            expect(r.body.code).toBe("invalid_client");
            expect(r.body.access_token).toBeUndefined();
        }
    });

    it("Falla cerrado si la credencial no está configurada en M1", async () => {
        delete process.env.DELEGACION_M9_CREDENCIAL;
        try {
            const respuesta = await pedirToken({ clientId: "1", ...PEDIDO });

            expect(respuesta.status).toBe(503);
            expect(respuesta.body.code).toBe("delegacion_no_configurada");
        } finally {
            process.env.DELEGACION_M9_CREDENCIAL = CREDENCIAL;
        }
    });

    it("Rechaza un clientId inválido y otro audience o scope", async () => {
        for (const clientId of [undefined, "", "abc", "0", "-3", "1.5"]) {
            const r = await pedirToken({ clientId, ...PEDIDO });
            expect(r.status).toBe(400);
            expect(r.body.code).toBe("invalid_request");
        }

        const otroScope = await pedirToken({ clientId: "1", audience: "m5", scope: "admin" });
        const otraAudiencia = await pedirToken({ clientId: "1", audience: "m7", scope: "ride-requests:write" });

        expect(otroScope.status).toBe(400);
        expect(otroScope.body.code).toBe("invalid_scope");
        expect(otraAudiencia.status).toBe(400);
        expect(otraAudiencia.body.code).toBe("invalid_scope");
    });

    it("No emite tokens para clientes inexistentes, bloqueados ni para otros roles", async () => {
        const conductor = await registrar("CONDUCTOR");
        const bloqueado = await registrar("CLIENTE");
        updateUserStatus(bloqueado, "BLOQUEADO");

        const inexistente = await pedirToken({ clientId: "999999999", ...PEDIDO });
        const deConductor = await pedirToken({ clientId: String(conductor), ...PEDIDO });
        const deBloqueado = await pedirToken({ clientId: String(bloqueado), ...PEDIDO });

        expect(inexistente.status).toBe(404);
        expect(inexistente.body.code).toBe("cliente_inexistente");
        expect(deConductor.status).toBe(403);
        expect(deConductor.body.code).toBe("cliente_no_habilitado");
        expect(deBloqueado.status).toBe(403);
        expect(deBloqueado.body.code).toBe("cliente_no_habilitado");
    });
});
