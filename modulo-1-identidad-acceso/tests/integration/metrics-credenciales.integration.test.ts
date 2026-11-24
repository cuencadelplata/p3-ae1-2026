import request from "supertest";
import {
    beforeAll,
    describe,
    expect,
    it,
    vi
} from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";

const email = `credenciales-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;
const password = "123456";
const dni = String(10_000_000 + Math.floor(Math.random() * 89_999_999));

async function leerMetrica(serie: string): Promise<number> {
    const response = await request(app).get("/metrics");
    const linea = response.text.split("\n").find((l) => l.startsWith(`${serie} `));

    return linea ? Number(linea.split(" ")[1]) : 0;
}

const serie = (operacion: string, resultado: string) =>
    `m1_credenciales_total{operacion="${operacion}",resultado="${resultado}"}`;

describe.sequential("AE4 - Métrica RF-1.4: m1_credenciales_total", () => {
    beforeAll(async () => {
        await redis.flushall();

        const registro = await request(app)
            .post("/auth/registrar-usuario")
            .send({ nombre: "Cred", apellido: "Enciales", dni, telefono: "11 5555 1234", email, password, rol: "CLIENTE" });
        expect(registro.status).toBe(201);
    });

    it("Contar una recuperación pedida y un reseteo exitoso", async () => {
        const solicitadasAntes = await leerMetrica(serie("recuperacion_solicitada", "ok"));
        const reseteadasAntes = await leerMetrica(serie("contrasena_reseteada", "ok"));

        (globalThis as any).__mensajesRabbit.length = 0;

        await request(app).post("/auth/solicitar-recuperacion").send({ email }).expect(200);

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const token = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;

        await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "NuevaClave123" })
            .expect(200);

        expect(await leerMetrica(serie("recuperacion_solicitada", "ok"))).toBe(solicitadasAntes + 1);
        expect(await leerMetrica(serie("contrasena_reseteada", "ok"))).toBe(reseteadasAntes + 1);
    });

    it("Contar como error un reseteo con token inválido y un pedido sin email", async () => {
        const reseteoErrorAntes = await leerMetrica(serie("contrasena_reseteada", "error"));
        const pedidoErrorAntes = await leerMetrica(serie("recuperacion_solicitada", "error"));

        const reseteo = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token: "token-que-no-existe", newPassword: "OtraClave123" });
        expect(reseteo.status).toBeGreaterThanOrEqual(400);

        await request(app).post("/auth/solicitar-recuperacion").send({}).expect(400);

        expect(await leerMetrica(serie("contrasena_reseteada", "error"))).toBe(reseteoErrorAntes + 1);
        expect(await leerMetrica(serie("recuperacion_solicitada", "error"))).toBe(pedidoErrorAntes + 1);
    });

    it("Contar una revocación de credenciales", async () => {
        const antes = await leerMetrica(serie("credenciales_revocadas", "ok"));

        const login = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password: "NuevaClave123" });
        expect(login.status).toBe(200);

        await request(app)
            .post("/auth/revocar-credenciales")
            .set("Authorization", `Bearer ${login.body.token}`)
            .expect(200);

        expect(await leerMetrica(serie("credenciales_revocadas", "ok"))).toBe(antes + 1);
    });
});
