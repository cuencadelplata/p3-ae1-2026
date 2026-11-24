import request from "supertest";
import {
    beforeEach,
    describe,
    expect,
    it
} from "vitest";

import app from "../../src/app";
import redis from "../../src/config/redis";
import { MAX_INTENTOS_FALLIDOS } from "../../src/services/login-attempts.service";

const email = `rate-limit-${Date.now()}@test.com`;
const password = "123456";

// DNI distinto en cada corrida: M1 no permite registrar dos usuarios con el mismo DNI.
const dni = String(10_000_000 + Math.floor(Math.random() * 89_999_999));

async function loginFallido() {
    return request(app)
        .post("/auth/iniciar-sesion")
        .send({ email, password: "incorrecta" });
}

describe.sequential(
    "RF-1.2 - Rate limiting de login con Redis",
    () => {
        beforeEach(async () => {
            await redis.flushall();
        });

        it("Registrar el usuario de prueba", async () => {
            const response = await request(app)
                .post("/auth/registrar-usuario")
                .send({
                    nombre: "Rate",
                    apellido: "Limit",
                    dni,
                    telefono: "11 5555 1234",
                    email,
                    password,
                    rol: "CLIENTE"
                });

            expect(response.status).toBe(201);
        });

        it(
            `Responder 429 después de ${MAX_INTENTOS_FALLIDOS} intentos fallidos`,
            async () => {
                for (let i = 0; i < MAX_INTENTOS_FALLIDOS; i++) {
                    const response = await loginFallido();
                    expect(response.status).toBe(401);
                }

                const bloqueado = await loginFallido();

                expect(bloqueado.status).toBe(429);
                expect(Number(bloqueado.headers["retry-after"])).toBeGreaterThan(0);
                expect(bloqueado.body.retryAfterSeconds).toBeGreaterThan(0);
            }
        );

        it(
            "Rechazar incluso la contraseña correcta mientras la IP está bloqueada",
            async () => {
                for (let i = 0; i < MAX_INTENTOS_FALLIDOS; i++) {
                    await loginFallido();
                }

                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({ email, password });

                expect(response.status).toBe(429);
            }
        );

        it(
            "Reiniciar el contador después de un login exitoso",
            async () => {
                for (let i = 0; i < MAX_INTENTOS_FALLIDOS - 1; i++) {
                    await loginFallido();
                }

                const exitoso = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({ email, password });

                expect(exitoso.status).toBe(200);

                // Como el contador volvió a 0, un nuevo fallo da 401 y no 429.
                const response = await loginFallido();
                expect(response.status).toBe(401);
            }
        );

        it(
            "No contar como fallo un request mal formado (400)",
            async () => {
                for (let i = 0; i < MAX_INTENTOS_FALLIDOS + 1; i++) {
                    const response = await request(app)
                        .post("/auth/iniciar-sesion")
                        .send({});

                    expect(response.status).toBe(400);
                }
            }
        );

        it(
            "Guardar el contador en Redis con vencimiento",
            async () => {
                await loginFallido();

                const claves = await redis.keys("login:fallidos:*");
                expect(claves.length).toBe(1);

                const ttl = await redis.ttl(claves[0]);
                expect(ttl).toBeGreaterThan(0);
                expect(ttl).toBeLessThanOrEqual(60);
            }
        );
    }
);