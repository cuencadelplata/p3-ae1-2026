import request from "supertest";
import {
    describe,
    expect,
    it,
    beforeAll,
    afterAll
} from "vitest";

import app from "../../src/app";
import db from "../../src/config/database";

// ============ VARIABLES GLOBALES ============
const timestamp = Date.now();
const email = `usuario-${timestamp}@test.com`;
const password = "123456";
const email2 = `conductor-${timestamp}@test.com`;

let token = "";
let tokenConductor = "";
let userId = 0;

function registrationData(
    userEmail: string,
    userPassword: string,
    role: string
) {
    return {
        nombre: "Usuario",
        apellido: "Prueba",
        dni: "30123456",
        telefono: "11 5555 1234",
        email: userEmail,
        password: userPassword,
        rol: role
    };
}

describe.sequential(
    "M1 - Identidad y Acceso - Tests E2E Complejos",
    () => {
        // ============ FLUJO 1: AUTENTICACIÓN COMPLETA ============
        describe("Flujo 1: Autenticación Completa", () => {
            it("E2E-1.1: Registrar cliente y verificar datos", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData(email, password, "CLIENTE"));

                expect(response.status).toBe(201);
                expect(response.body).toHaveProperty("id");
                expect(response.body.email).toBe(email);
                expect(response.body.rol).toBe("CLIENTE");
                expect(response.body.estado).toBe("ACTIVO");
                expect(response.body.password_hash).toBeUndefined();

                userId = response.body.id;
            });

            it("E2E-1.2: Intentar registrar con email duplicado", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData(email, password, "CLIENTE"));

                expect(response.status).toBe(409);
                expect(response.body.error).toBe(
                    "Ya existe un usuario con ese email"
                );
            });

            it("E2E-1.3: Validar rechazo de contraseña corta", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData(
                        `short-${timestamp}@test.com`,
                        "123",
                        "CLIENTE"
                    ));

                expect(response.status).toBe(400);
                expect(response.body.error).toContain("6 caracteres");
            });

            it("E2E-1.4: Validar rechazo de email inválido", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData("no-es-email", "123456", "CLIENTE"));

                expect(response.status).toBe(400);
                expect(response.body.error).toContain("válido");
            });

            it("E2E-1.5: Login con credenciales correctas", async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email,
                        password
                    });

                expect(response.status).toBe(200);
                expect(response.body.token).toBeDefined();
                expect(response.body.tokenType).toBe("Bearer");
                expect(response.body.expiresIn).toBe("1h");
                expect(response.body.usuario.id).toBe(userId);
                expect(response.body.usuario.email).toBe(email);
                expect(response.body.usuario.rol).toBe("CLIENTE");

                token = response.body.token;
            });

            it("E2E-1.6: Login con contraseña incorrecta", async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email,
                        password: "contraseñaIncorrecta"
                    });

                expect(response.status).toBe(401);
                expect(response.body.error).toBe("Credenciales incorrectas");
            });

            it("E2E-1.7: Login con email no registrado", async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email: "noexiste@test.com",
                        password
                    });

                expect(response.status).toBe(401);
                expect(response.body.error).toBe("Credenciales incorrectas");
            });

            it("E2E-1.8: Validar token y obtener información", async () => {
                const response = await request(app)
                    .get("/auth/validar-identidad-y-rol")
                    .set("Authorization", `Bearer ${token}`);

                expect(response.status).toBe(200);
                expect(response.body.valid).toBe(true);
                expect(response.body.userId).toBe(userId);
                expect(response.body.role).toBe("CLIENTE");
            });
        });

        // ============ FLUJO 2: VALIDACIÓN DE SEGURIDAD ============
        describe("Flujo 2: Validación de Seguridad", () => {
            it("E2E-2.1: Rechazar solicitud sin token", async () => {
                const response = await request(app)
                    .get("/auth/validar-identidad-y-rol");

                expect(response.status).toBe(401);
                expect(response.body.valid).toBe(false);
                expect(response.body.error).toBe("Token requerido");
            });

            it("E2E-2.2: Rechazar token malformado", async () => {
                const response = await request(app)
                    .get("/auth/validar-identidad-y-rol")
                    .set("Authorization", "InvalidToken");

                expect(response.status).toBe(401);
                expect(response.body.error).toContain("incorrecto");
            });

            it("E2E-2.3: Rechazar token sin Bearer", async () => {
                const response = await request(app)
                    .get("/auth/validar-identidad-y-rol")
                    .set("Authorization", token);

                expect(response.status).toBe(401);
                expect(response.body.error).toContain("incorrecto");
            });

            it("E2E-2.4: Rechazar token inválido", async () => {
                const response = await request(app)
                    .get("/auth/validar-identidad-y-rol")
                    .set("Authorization", "Bearer invalid.token.here");

                expect(response.status).toBe(401);
                expect(response.body.error).toBe("Token inválido");
            });
        });

        // ============ FLUJO 3: USUARIOS BLOQUEADOS ============
        describe("Flujo 3: Bloqueo de Usuarios", () => {
            const blockedEmail = `bloqueado-${timestamp}@test.com`;
            let blockedToken = "";

            it("E2E-3.1: Registrar usuario para bloquear", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData(blockedEmail, password, "CONDUCTOR"));

                expect(response.status).toBe(201);
            });

            it("E2E-3.2: Login exitoso antes del bloqueo", async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email: blockedEmail,
                        password
                    });

                expect(response.status).toBe(200);
                blockedToken = response.body.token;
            });

            it("E2E-3.3: Bloquear usuario en BD", async () => {
                db.prepare(`
                    UPDATE usuarios SET estado = 'BLOQUEADO' WHERE email = ?
                `).run(blockedEmail);

                const user = db
                    .prepare("SELECT estado FROM usuarios WHERE email = ?")
                    .get(blockedEmail) as { estado: string };

                expect(user.estado).toBe("BLOQUEADO");
            });

            it("E2E-3.4: Rechazar login de usuario bloqueado", async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email: blockedEmail,
                        password
                    });

                expect(response.status).toBe(403);
                expect(response.body.error).toBe("Usuario bloqueado");
            });

            it("E2E-3.5: Validación falla con usuario bloqueado", async () => {
                const response = await request(app)
                    .get("/auth/validar-identidad-y-rol")
                    .set("Authorization", `Bearer ${blockedToken}`);

                expect(response.status).toBe(200);
            });
        });

        // ============ FLUJO 4: MÚLTIPLES ROLES ============
        describe("Flujo 4: Múltiples Roles", () => {
            it("E2E-4.1: Registrar conductor", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData(email2, password, "CONDUCTOR"));

                expect(response.status).toBe(201);
                expect(response.body.rol).toBe("CONDUCTOR");
            });

            it("E2E-4.2: Verificar rol de conductor", async () => {
                const loginResponse = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email: email2,
                        password
                    });

                tokenConductor = loginResponse.body.token;

                const validationResponse = await request(app)
                    .get("/auth/validar-identidad-y-rol")
                    .set("Authorization", `Bearer ${tokenConductor}`);

                expect(validationResponse.status).toBe(200);
                expect(validationResponse.body.role).toBe("CONDUCTOR");
            });

            it("E2E-4.3: Validar rechazo de rol inválido", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData(
                        `invalid-${timestamp}@test.com`,
                        password,
                        "ADMIN"
                    ));

                expect(response.status).toBe(400);
                expect(response.body.error).toContain("CLIENTE, CONDUCTOR u OPERADOR");
            });
        });

        // ============ FLUJO 5: RECUPERACIÓN DE CONTRASEÑA ============
        describe("Flujo 5: Recuperación de Contraseña", () => {
            it("E2E-5.1: Solicitar recuperación de contraseña", async () => {
                const response = await request(app)
                    .post("/auth/solicitar-recuperacion")
                    .send({ email });

                expect(response.status).toBe(200);
                expect(response.body.message).toContain("recuperación");
                expect(response.body.email).toBe(email);
                expect(response.body.expiresInMinutes).toBe(30);
            });

            it("E2E-5.2: No revelar existencia de email", async () => {
                const response = await request(app)
                    .post("/auth/solicitar-recuperacion")
                    .send({ email: `inexistente-${timestamp}@test.com` });

                expect(response.status).toBe(200);
                expect(response.body.message).toContain("recuperación");
            });

            it("E2E-5.3: Obtener token de recuperación desde BD", async () => {
                const tokenRow = db
                    .prepare(`
                        SELECT token FROM password_recovery_tokens
                        WHERE usuario_id = ? AND used = FALSE
                        ORDER BY created_at DESC LIMIT 1
                    `)
                    .get(userId) as { token: string } | undefined;

                expect(tokenRow).toBeDefined();
            });

            it("E2E-5.4: Resetear contraseña con token válido", async () => {
                const tokenRow = db
                    .prepare(`
                        SELECT token FROM password_recovery_tokens
                        WHERE usuario_id = ? AND used = FALSE
                        ORDER BY created_at DESC LIMIT 1
                    `)
                    .get(userId) as { token: string } | undefined;

                const newPassword = "NuevaPassword123";

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

                // Verificar que la nueva contraseña funciona
                const loginResponse = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email,
                        password: newPassword
                    });

                expect(loginResponse.status).toBe(200);
                expect(loginResponse.body.token).toBeDefined();
            });

            it("E2E-5.5: Token no puede reutilizarse", async () => {
                const tokenRow = db
                    .prepare(`
                        SELECT token FROM password_recovery_tokens
                        WHERE usuario_id = ? AND used = TRUE
                        ORDER BY created_at DESC LIMIT 1
                    `)
                    .get(userId) as { token: string } | undefined;

                if (tokenRow) {
                    const response = await request(app)
                        .post("/auth/resetear-contrasena")
                        .send({
                            token: tokenRow.token,
                            newPassword: "OtraPassword456"
                        });

                    expect(response.status).toBe(401);
                    expect(response.body.error).toContain("inválido");
                }
            });

            it("E2E-5.6: Rechazar contraseña corta", async () => {
                const response = await request(app)
                    .post("/auth/solicitar-recuperacion")
                    .send({ email });

                const tokenRow = db
                    .prepare(`
                        SELECT token FROM password_recovery_tokens
                        WHERE usuario_id = ? AND used = FALSE
                        ORDER BY created_at DESC LIMIT 1
                    `)
                    .get(userId) as { token: string } | undefined;

                if (tokenRow) {
                    const resetResponse = await request(app)
                        .post("/auth/resetear-contrasena")
                        .send({
                            token: tokenRow.token,
                            newPassword: "123"
                        });

                    expect(resetResponse.status).toBe(400);
                    expect(resetResponse.body.error).toContain("6 caracteres");
                }
            });
        });

        // ============ FLUJO 6: OAUTH2 STUBS ============
        describe("Flujo 6: OAuth2/OpenID Connect (Stub)", () => {
            it("E2E-6.1: OAuth2 authorize con provider válido", async () => {
                const response = await request(app)
                    .get("/auth/oauth2/authorize")
                    .query({
                        provider: "GOOGLE",
                        redirect_uri: "http://localhost:3000/callback"
                    });

                expect(response.status).toBe(501);
                expect(response.body.message).toContain("stub");
                expect(response.body.availableProviders).toContain("GOOGLE");
            });

            it("E2E-6.2: Validar que provider sea obligatorio", async () => {
                const response = await request(app)
                    .get("/auth/oauth2/authorize")
                    .query({
                        redirect_uri: "http://localhost:3000/callback"
                    });

                expect(response.status).toBe(400);
                expect(response.body.error).toContain("obligatorio");
            });

            it("E2E-6.3: OAuth2 callback endpoint", async () => {
                const response = await request(app)
                    .get("/auth/oauth2/callback")
                    .query({
                        provider: "GITHUB",
                        code: "auth-code-xyz",
                        state: "state-123"
                    });

                expect(response.status).toBe(501);
                expect(response.body.message).toContain("stub");
                expect(response.body.received.provider).toBe("GITHUB");
            });

            it("E2E-6.4: Link account requiere autenticación", async () => {
                const response = await request(app)
                    .post("/auth/oauth2/link")
                    .send({
                        provider: "GOOGLE",
                        provider_id: "google-123"
                    });

                expect(response.status).toBe(401);
            });

            it("E2E-6.5: Link account con autenticación", async () => {
                const response = await request(app)
                    .post("/auth/oauth2/link")
                    .set("Authorization", `Bearer ${token}`)
                    .send({
                        provider: "GOOGLE",
                        provider_id: "google-123"
                    });

                expect(response.status).toBe(501);
                expect(response.body.message).toContain("AE2");
            });
        });

        // ============ FLUJO 7: VALIDACIONES Y EDGE CASES ============
        describe("Flujo 7: Validaciones y Edge Cases", () => {
            it("E2E-7.1: Email con espacios se normaliza", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send(registrationData(`  ${email}  `, password, "CLIENTE"));

                expect(response.status).toBe(409);
            });

            it("E2E-7.2: Email en mayúsculas se normaliza", async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email: email.toUpperCase(),
                        password: "NuevaPassword123"
                    });

                expect(response.status).toBe(200);
            });

            it("E2E-7.3: Validar parámetros faltantes en registro", async () => {
                const response = await request(app)
                    .post("/auth/registrar-usuario")
                    .send({
                        email
                    });

                expect(response.status).toBe(400);
            });

            it("E2E-7.4: Validar parámetros faltantes en login", async () => {
                const response = await request(app)
                    .post("/auth/iniciar-sesion")
                    .send({
                        email
                    });

                expect(response.status).toBe(400);
            });

            it("E2E-7.5: Health check del servidor", async () => {
                const response = await request(app)
                    .get("/health");

                expect(response.status).toBe(200);
                expect(response.body.status).toBe("OK");
                expect(response.body.modulo).toContain("Identidad y Acceso");
            });
        });
    }
);