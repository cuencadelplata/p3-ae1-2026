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
let recoveryToken = "";

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

        // ============ RF-1.4: Recuperación y Permiso ============

        it(
            "RF-1.4: Solicitar recuperación de contraseña",
            async () => {
                const response = await request(app)
                    .post("/auth/solicitar-recuperacion")
                    .send({
                        email
                    });

                expect(response.status).toBe(200);
                expect(
                    response.body.message
                ).toContain("recuperación");
                expect(response.body.email).toBe(email);
                expect(
                    response.body.expiresInMinutes
                ).toBe(30);
            }
        );

        it(
            "RF-1.4: No revelar si email existe o no",
            async () => {
                const nonExistentEmail =
                    `no-existe-${Date.now()}@test.com`;

                const response = await request(app)
                    .post("/auth/solicitar-recuperacion")
                    .send({
                        email: nonExistentEmail
                    });

                expect(response.status).toBe(200);
                expect(
                    response.body.message
                ).toContain("recuperación");
            }
        );

        it(
            "RF-1.4: Resetear contraseña con token válido",
            async () => {
                // Obtener el token de la base de datos
                const tokenRow = db
                    .prepare(`
                        SELECT token FROM password_recovery_tokens
                        WHERE usuario_id = (
                            SELECT id FROM usuarios WHERE email = ?
                        )
                        AND used = FALSE
                        ORDER BY created_at DESC
                        LIMIT 1
                    `)
                    .get(email) as { token: string } | undefined;

                expect(tokenRow).toBeDefined();

                const newPassword = "nuevaContrasena123";

                const response = await request(app)
                    .post("/auth/resetear-contrasena")
                    .send({
                        token: tokenRow!.token,
                        newPassword
                    });

                expect(response.status).toBe(200);
                expect(response.body.message).toBe(
                    "Contraseña actualizada exitosamente"
                );
                expect(response.body.email).toBe(email);

                // Verificar que la nueva contraseña funciona
                const loginResponse =
                    await request(app)
                        .post("/auth/iniciar-sesion")
                        .send({
                            email,
                            password: newPassword
                        });

                expect(loginResponse.status).toBe(200);
                expect(
                    loginResponse.body.token
                ).toBeDefined();
            }
        );

        it(
            "RF-1.4: Rechazar token de recuperación inválido",
            async () => {
                const response = await request(app)
                    .post("/auth/resetear-contrasena")
                    .send({
                        token: "invalid-token-123",
                        newPassword: "nuevaContrasena123"
                    });

                expect(response.status).toBe(401);
                expect(response.body.error).toContain(
                    "inválido"
                );
            }
        );

        it(
            "RF-1.4: Rechazar contraseña corta en recuperación",
            async () => {
                const tokenRow = db
                    .prepare(`
                        SELECT token FROM password_recovery_tokens
                        WHERE usuario_id = (
                            SELECT id FROM usuarios WHERE email = ?
                        )
                        AND used = FALSE
                        LIMIT 1
                    `)
                    .get(email) as { token: string } | undefined;

                if (tokenRow) {
                    const response = await request(app)
                        .post("/auth/resetear-contrasena")
                        .send({
                            token: tokenRow.token,
                            newPassword: "123"
                        });

                    expect(response.status).toBe(400);
                    expect(response.body.error).toContain(
                        "al menos 6"
                    );
                }
            }
        );

        // ============ RF-1.5: Integración Estándar OAuth2 ============

        it(
            "RF-1.5: OAuth2 authorize endpoint (stub/501)",
            async () => {
                const response = await request(app)
                    .get("/auth/oauth2/authorize")
                    .query({
                        provider: "GOOGLE",
                        redirect_uri: "http://localhost:3000/callback"
                    });

                expect(response.status).toBe(501);
                expect(response.body.message).toContain(
                    "stub de contrato"
                );
                expect(
                    response.body.availableProviders
                ).toContain("GOOGLE");
            }
        );

        it(
            "RF-1.5: OAuth2 authorize valida provider requerido",
            async () => {
                const response = await request(app)
                    .get("/auth/oauth2/authorize")
                    .query({
                        redirect_uri: "http://localhost:3000/callback"
                    });

                expect(response.status).toBe(400);
                expect(response.body.error).toContain(
                    "Provider es obligatorio"
                );
            }
        );

        it(
            "RF-1.5: OAuth2 callback endpoint (stub/501)",
            async () => {
                const response = await request(app)
                    .get("/auth/oauth2/callback")
                    .query({
                        provider: "GITHUB",
                        code: "auth-code-123",
                        state: "state-token-456"
                    });

                expect(response.status).toBe(501);
                expect(response.body.message).toContain(
                    "stub de contrato"
                );
                expect(response.body.received.provider).toBe(
                    "GITHUB"
                );
            }
        );

        it(
            "RF-1.5: OAuth2 link account endpoint (stub/501)",
            async () => {
                const response = await request(app)
                    .post("/auth/oauth2/link")
                    .set(
                        "Authorization",
                        `Bearer ${token}`
                    )
                    .send({
                        provider: "GOOGLE",
                        provider_id: "google-user-123"
                    });

                expect(response.status).toBe(501);
                expect(response.body.message).toContain(
                    "planeada para AE2"
                );
            }
        );
    }
);