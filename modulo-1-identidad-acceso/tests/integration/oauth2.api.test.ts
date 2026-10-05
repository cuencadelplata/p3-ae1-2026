import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { initDatabase } from "../../src/config/database";
import { updateUserStatus } from "../../src/repositories/user.repository";

describe("IntegraciÃ³n API: RF-1.5 IntegraciÃ³n EstÃ¡ndar OAuth2 / OpenID Connect", () => {
    beforeAll(() => {
        const db = initDatabase();
        db.prepare("DELETE FROM oauth2_providers WHERE provider_name = 'MOCK'").run();
        db.prepare("DELETE FROM usuarios WHERE email = 'usuario.oauth2@movilidad-urbana.test'").run();
    });

    describe("GET /health", () => {
        it("debe retornar estado UP y los Backing Services disponibles", async () => {
            const response = await request(app).get("/health");

            expect(response.status).toBe(200);
            expect(["OK", "UP"]).toContain(response.body.status);
            expect(response.body.service).toBe("modulo-1-identidad-acceso");
            expect(response.body.backingServices.identityProviders).toBeInstanceOf(Array);
        });
    });

    describe("GET /auth/oauth2/providers", () => {
        it("debe retornar los proveedores OAuth2 configurados", async () => {
            const response = await request(app).get("/auth/oauth2/providers");

            expect(response.status).toBe(200);
            expect(response.body.providers.length).toBeGreaterThanOrEqual(3);
            const provNames = response.body.providers.map((p: { provider: string }) => p.provider);
            expect(provNames).toContain("MOCK");
            expect(provNames).toContain("GOOGLE");
            expect(provNames).toContain("AUTH0");
        });
    });

    describe("GET /auth/oauth2/authorize", () => {
        it("debe retornar URL de autorizaciÃ³n y state cuando no se solicita redirecciÃ³n", async () => {
            const response = await request(app)
                .get("/auth/oauth2/authorize")
                .query({ provider: "MOCK", role: "CONDUCTOR" });

            expect(response.status).toBe(200);
            expect(response.body.authorizationUrl).toBeDefined();
            expect(response.body.state).toBeDefined();
            expect(response.body.provider).toBe("MOCK");
        });

        it("debe redirigir con HTTP 302 cuando redirect=true", async () => {
            const response = await request(app)
                .get("/auth/oauth2/authorize")
                .query({ provider: "MOCK", redirect: "true" });

            expect(response.status).toBe(302);
            expect(response.headers.location).toBeDefined();
        });

        it("debe rechazar proveedor desconocido con 400", async () => {
            const response = await request(app)
                .get("/auth/oauth2/authorize")
                .query({ provider: "FACEBOOK" });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain("no soportado");
        });
    });

    describe("Flujo Completo: Authorize -> Callback -> ValidaciÃ³n de Token", () => {
        let issuedToken = "";
        let userId = 0;

        it("Paso 1 y 2: AutenticaciÃ³n completa vÃ­a OAuth2 Callback y emisiÃ³n de JWT", async () => {
            // 1. Iniciar autorizaciÃ³n para obtener state anti-CSRF vÃ¡lido
            const authRes = await request(app)
                .get("/auth/oauth2/authorize")
                .query({ provider: "MOCK", role: "CONDUCTOR" });

            const { state } = authRes.body;

            // 2. Simular retorno del proveedor IdP al endpoint callback
            const callbackRes = await request(app)
                .get("/auth/oauth2/callback")
                .query({
                    code: "mock_auth_code_001",
                    state,
                    provider: "MOCK"
                });

            expect(callbackRes.status).toBe(200);
            expect(callbackRes.body.token).toBeDefined();
            expect(callbackRes.body.tokenType).toBe("Bearer");
            expect(callbackRes.body.usuario.rol).toBe("CONDUCTOR");
            expect(callbackRes.body.usuario.email).toContain("@");
            expect(callbackRes.body.provider).toBe("MOCK");

            issuedToken = callbackRes.body.token;
            userId = callbackRes.body.usuario.id;
        });

        it("Paso 3: Validar ticket emitido en /auth/validar-identidad-y-rol (IntegraciÃ³n M2, M3, M5, M6)", async () => {
            const validationRes = await request(app)
                .get("/auth/validar-identidad-y-rol")
                .set("Authorization", `Bearer ${issuedToken}`);

            expect(validationRes.status).toBe(200);
            expect(validationRes.body.valid).toBe(true);
            expect(validationRes.body.usuario.id).toBe(userId);
            expect(validationRes.body.usuario.rol).toBe("CONDUCTOR");
            expect(validationRes.body.authMethod).toBe("oauth2");
        });

        it("debe rechazar /auth/validar-identidad-y-rol sin token con 401", async () => {
            const response = await request(app).get("/auth/validar-identidad-y-rol");

            expect(response.status).toBe(401);
            expect(response.body.code).toBe("missing_token");
        });

        it("debe rechazar /auth/validar-identidad-y-rol con token adulterado con 401", async () => {
            const response = await request(app)
                .get("/auth/validar-identidad-y-rol")
                .set("Authorization", `Bearer ${issuedToken}_invalido`);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe("invalid_token");
        });

        it("debe detectar usuario bloqueado en la validación (RNF seguridad)", async () => {
            // Bloquear al usuario en la base de datos
            updateUserStatus(userId, "BLOQUEADO");

            const response = await request(app)
                .get("/auth/validar-identidad-y-rol")
                .set("Authorization", `Bearer ${issuedToken}`);

            expect(response.status).toBe(200);
            expect(response.body.valid).toBe(false);
            expect(response.body.usuario.estado).toBe("BLOQUEADO");

            // Restaurar estado
            updateUserStatus(userId, "ACTIVO");
        });
    });

    describe("Manejo de Errores en Callback OAuth2", () => {
        it("debe retornar 400 si falta el parÃ¡metro 'code'", async () => {
            const response = await request(app)
                .get("/auth/oauth2/callback")
                .query({ state: "algun_state" });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe("missing_code");
        });

        it("debe retornar 400 si falta el parÃ¡metro 'state'", async () => {
            const response = await request(app)
                .get("/auth/oauth2/callback")
                .query({ code: "mock_code" });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe("missing_state");
        });

        it("debe retornar 400 si el state fue adulterado (Ataque CSRF)", async () => {
            const response = await request(app)
                .get("/auth/oauth2/callback")
                .query({
                    code: "mock_code",
                    state: "state_falso_no_firmado"
                });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe("invalid_state");
        });
    });
});

