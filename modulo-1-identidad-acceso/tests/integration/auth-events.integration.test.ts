import request from "supertest";
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";
import { EVENTOS_AUTH } from "../../src/messaging/auth.publisher";
import { MAX_INTENTOS_FALLIDOS } from "../../src/services/login-attempts.service";

const email = `eventos-${Date.now()}@test.com`;
const password = "123456";

function mensajesPublicados(): { routingKey: string; contenido: any }[] {
    return (globalThis as any).__mensajesRabbit ?? [];
}

function vaciarMensajes(): void {
    mensajesPublicados().length = 0;
}

describe.sequential(
    "RF-1.2 - Eventos asincrónicos en RabbitMQ",
    () => {
        beforeEach(async () => {
            await redis.flushall();
            vaciarMensajes();
        });

        it("Registrar el usuario de prueba", async () => {
            const response = await request(app)
                .post("/auth/registrar-usuario")
                .send({
                    nombre: "Eventos",
                    apellido: "Rabbit",
                    dni: "30123456",
                    telefono: "11 5555 1234",
                    email,
                    password,
                    rol: "CONDUCTOR"
                });

            expect(response.status).toBe(201);
        });

        it("Publicar auth.login_exitoso con el userId y el rol", async () => {
            const response = await request(app)
                .post("/auth/iniciar-sesion")
                .send({ email, password });

            expect(response.status).toBe(200);

            // La publicación es asincrónica, así que se espera a que llegue.
            await vi.waitFor(() => {
                expect(mensajesPublicados().length).toBe(1);
            });

            const mensaje = mensajesPublicados()[0];

            expect(mensaje.routingKey).toBe(EVENTOS_AUTH.LOGIN_EXITOSO);
            expect(mensaje.contenido.modulo).toBe("M1");
            expect(mensaje.contenido.datos.userId).toBe(response.body.usuario.id);
            expect(mensaje.contenido.datos.role).toBe("CONDUCTOR");
        });

        it("Publicar auth.ip_bloqueada una sola vez al llegar al límite", async () => {
            for (let i = 0; i < MAX_INTENTOS_FALLIDOS + 2; i++) {
                await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({ email, password: "incorrecta" });
            }

            await vi.waitFor(() => {
                expect(mensajesPublicados().length).toBe(1);
            });

            const mensaje = mensajesPublicados()[0];

            expect(mensaje.routingKey).toBe(EVENTOS_AUTH.IP_BLOQUEADA);
            expect(mensaje.contenido.datos.intentos).toBe(MAX_INTENTOS_FALLIDOS);
            expect(mensaje.contenido.datos.bloqueadaPorSegundos).toBeGreaterThan(0);
        });

        it("No publicar eventos cuando las credenciales son incorrectas pero no se llegó al límite", async () => {
            await request(app)
                .post("/auth/iniciar-sesion")
                .send({ email, password: "incorrecta" });

            // Se da un margen para que una publicación (si la hubiera) llegue.
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mensajesPublicados().length).toBe(0);
        });
    }
);
