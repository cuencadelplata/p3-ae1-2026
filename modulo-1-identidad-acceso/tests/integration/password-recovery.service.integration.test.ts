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
import { obtenerCanal } from "../../src/config/rabbitmq";

describe("RF-1.4 - Recuperación de contraseña con Redis y RabbitMQ", () => {
    it("Guardar el token en Redis y publicar el evento al solicitar la recuperación", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        const registro = await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        const response = await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        expect(response.status).toBe(200);
        expect(response.body.email).toBe(email);
        expect(response.body.expiresInMinutes).toBe(15);
        expect(response.body.token).toBeUndefined();

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const mensaje = (globalThis as any).__mensajesRabbit[0];

        expect(mensaje.routingKey).toBe("auth.recuperacion_solicitada");
        expect(mensaje.contenido.datos.userId).toBe(registro.body.id);
        expect(mensaje.contenido.datos.email).toBe(email);
        expect(mensaje.contenido.datos.token).toHaveLength(64);
        expect(mensaje.contenido.datos.expiraEnSegundos).toBe(900);

        const claves = await redis.keys("recuperacion:token:*");
        const ttl = await redis.ttl(claves[0]);

        expect(claves.length).toBe(1);
        expect(ttl).toBeGreaterThan(890);
        expect(ttl).toBeLessThanOrEqual(900);
    });

    it("Responder lo mismo y no publicar nada si el email no está registrado", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const response = await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email: `no-existe-${Date.now()}@test.com` });

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(response.status).toBe(200);
        expect(response.body.message).toContain("Si el email existe");
        expect((globalThis as any).__mensajesRabbit.length).toBe(0);
        expect(await redis.keys("*")).toEqual([]);
    });

    it("Rechazar un email con formato inválido", async () => {
        const response = await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email: "sin-arroba" });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("Email inválido");
    });

    it("Cambiar la contraseña con el token recibido en el evento", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const token = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;

        const response = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "NuevaClave123" });

        const loginViejo = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password: "123456" });

        const loginNuevo = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password: "NuevaClave123" });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("Contraseña actualizada exitosamente");
        expect(loginViejo.status).toBe(401);
        expect(loginNuevo.status).toBe(200);
        expect(await redis.keys("recuperacion:*")).toEqual([]);
    });

    it("Rechazar el token cuando se intenta usar por segunda vez", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const token = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;

        const primerUso = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "NuevaClave123" });

        const segundoUso = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "OtraClave456" });

        expect(primerUso.status).toBe(200);
        expect(segundoUso.status).toBe(401);
        expect(segundoUso.body.error).toBe("Token de recuperación inválido o expirado");
    });

    it("Aceptar un solo cambio cuando llegan dos pedidos juntos con el mismo token", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const token = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;

        const respuestas = await Promise.all([
            request(app)
                .post("/auth/resetear-contrasena")
                .send({ token, newPassword: "ClaveUno123" }),
            request(app)
                .post("/auth/resetear-contrasena")
                .send({ token, newPassword: "ClaveDos456" })
        ]);

        const estados = respuestas
            .map((respuesta) => respuesta.status)
            .sort();

        expect(estados).toEqual([200, 401]);
    });

    it("Rechazar el token cuando pasaron los 15 minutos", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const token = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 16 * 60 * 1000);

        const response = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "NuevaClave123" });

        vi.useRealTimers();

        expect(response.status).toBe(401);
        expect(response.body.error).toBe("Token de recuperación inválido o expirado");
    });

    it("Dejar sin efecto el primer token si se pide otro", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(2);
        });

        const primerToken = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;
        const segundoToken = (globalThis as any).__mensajesRabbit[1].contenido.datos.token;

        const conElPrimero = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token: primerToken, newPassword: "NuevaClave123" });

        const conElSegundo = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token: segundoToken, newPassword: "NuevaClave123" });

        expect(conElPrimero.status).toBe(401);
        expect(conElSegundo.status).toBe(200);
    });

    it("No consumir el token si la contraseña nueva es muy corta", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const token = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;

        const corta = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "123" });

        const correcta = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "NuevaClave123" });

        expect(corta.status).toBe(400);
        expect(corta.body.error).toContain("6 caracteres");
        expect(correcta.status).toBe(200);
    });

    it("Rechazar un token que no tiene el formato esperado", async () => {
        const response = await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token: "token-inventado", newPassword: "NuevaClave123" });

        expect(response.status).toBe(401);
    });

    it("Revocar el JWT que el usuario tenía antes de cambiar la contraseña", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        const registro = await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        // JWT igual al que entrega el login, pero emitido un minuto antes.
        const jwtAnterior = jwt.sign(
            {
                userId: registro.body.id,
                role: "CLIENTE",
                iat: Math.floor(Date.now() / 1000) - 60
            },
            process.env.JWT_SECRET || "clave-local-desarrollo-m1-cambiar-en-produccion",
            { expiresIn: "1h" }
        );

        const antes = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${jwtAnterior}`);

        await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const token = (globalThis as any).__mensajesRabbit[0].contenido.datos.token;

        await request(app)
            .post("/auth/resetear-contrasena")
            .send({ token, newPassword: "NuevaClave123" });

        const despues = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${jwtAnterior}`);

        const loginNuevo = await request(app)
            .post("/auth/iniciar-sesion")
            .send({ email, password: "NuevaClave123" });

        const conLoginNuevo = await request(app)
            .get("/auth/validar-identidad-y-rol")
            .set("Authorization", `Bearer ${loginNuevo.body.token}`);

        expect(antes.status).toBe(200);
        expect(despues.status).toBe(401);
        expect(despues.body.error).toBe("Credencial revocada");
        expect(conLoginNuevo.status).toBe(200);
    });

    it("Responder 503 a cualquier email si Redis está caído", async () => {
        const ping = vi
            .spyOn(redis, "ping")
            .mockRejectedValue(new Error("Redis caído"));

        const response = await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email: `cualquiera-${Date.now()}@test.com` });

        ping.mockRestore();

        expect(response.status).toBe(503);
        expect(response.body.error).toContain("no está disponible");
    });

    it("Responder 200 aunque RabbitMQ esté caído y dejar el token con vencimiento", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const email = `recuperacion-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`;

        await request(app)
            .post("/auth/registrar-usuario")
            .send({
                nombre: "Ana",
                apellido: "Recuperación",
                dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
                telefono: "11 5555 1234",
                email,
                password: "123456",
                rol: "CLIENTE"
            });

        const canal = await obtenerCanal();
        const publishOriginal = canal.publish;
        const errores = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        canal.publish = () => {
            throw new Error("RabbitMQ caído");
        };

        const response = await request(app)
            .post("/auth/solicitar-recuperacion")
            .send({ email });

        await vi.waitFor(() => {
            expect(errores).toHaveBeenCalled();
        });

        canal.publish = publishOriginal;
        errores.mockRestore();

        const claves = await redis.keys("recuperacion:token:*");

        expect(response.status).toBe(200);
        expect((globalThis as any).__mensajesRabbit.length).toBe(0);
        expect(claves.length).toBe(1);
        expect(await redis.ttl(claves[0])).toBeGreaterThan(0);
    });
});
