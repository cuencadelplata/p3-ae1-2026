import request from "supertest";
import {
    describe,
    expect,
    it
} from "vitest";

import app from "../../src/app";
import db from "../../src/config/database";

const email = `usuario-${Date.now()}@test.com`;
const password = "123456";

let token = "";

describe.sequential(
    "M1 - Identidad y Acceso",
    () => {
        it("Registrar un usuario", async () => {
            const response = await request(app)
                .post("/auth/registrar-usuario")
                .send({
                    email,
                    password,
                    rol: "CLIENTE"
                });

            expect(response.status).toBe(201);
            expect(response.body.email).toBe(email);
            expect(response.body.rol).toBe("CLIENTE");
            expect(response.body.estado).toBe("ACTIVO");
            expect(
                response.body.password_hash
            ).toBeUndefined();
        });

        it(
            "Impedir el registro de un email repetido",
            async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send({
                        email,
                        password,
                        rol: "CLIENTE"
                    });

                expect(response.status).toBe(409);
                expect(response.body.error).toBe(
                    "Ya existe un usuario con ese email"
                );
            }
        );

        it("Iniciar sesión", async () => {
            const response = await request(app)
                .post("/auth/iniciar-sesion")
                .send({
                    email,
                    password
                });

            expect(response.status).toBe(200);
            expect(response.body.token).toBeDefined();
            expect(response.body.tokenType).toBe("Bearer");

            token = response.body.token;
        });

        it(
            "Rechazar credenciales incorrectas",
            async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email,
                        password: "incorrecta"
                    });

                expect(response.status).toBe(401);
                expect(response.body.error).toBe(
                    "Credenciales incorrectas"
                );
            }
        );

        it("Validar identidad y rol", async () => {
            const response = await request(app)
                .get("/auth/validar-identidad-y-rol")
                .set(
                    "Authorization",
                    `Bearer ${token}`
                );

            expect(response.status).toBe(200);
            expect(response.body.valid).toBe(true);
            expect(response.body.role).toBe("CLIENTE");
            expect(response.body.userId).toBeDefined();
        });

        it(
            "Rechazar una solicitud sin token",
            async () => {
                const response = await request(app)
                    .get(
                        "/auth/validar-identidad-y-rol"
                    );

                expect(response.status).toBe(401);
                expect(response.body.valid).toBe(false);
                expect(response.body.error).toBe(
                    "Token requerido"
                );
            }
        );

        it(
            "Impedir el acceso a usuarios bloqueados",
            async () => {
                const blockedEmail =
                    `bloqueado-${Date.now()}@test.com`;

                const registerResponse =
                    await request(app)
                        .post("/auth/registrar-usuario")
                        .send({
                            email: blockedEmail,
                            password,
                            rol: "CONDUCTOR"
                        });

                expect(
                    registerResponse.status
                ).toBe(201);

                db.prepare(`
                    UPDATE usuarios
                    SET estado = 'BLOQUEADO'
                    WHERE email = ?
                `).run(blockedEmail);

                const loginResponse =
                    await request(app)
                        .post("/auth/iniciar-sesion")
                        .send({
                            email: blockedEmail,
                            password
                        });

                expect(loginResponse.status).toBe(403);
                expect(loginResponse.body.error).toBe(
                    "Usuario bloqueado"
                );
            }
        );
    }
);