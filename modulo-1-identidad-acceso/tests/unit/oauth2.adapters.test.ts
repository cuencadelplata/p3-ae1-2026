import { describe, it, expect } from "vitest";
import { MockOAuth2Adapter } from "../../src/services/oauth2/adapters/mock.adapter";
import { GoogleOAuth2Adapter } from "../../src/services/oauth2/adapters/google.adapter";
import { Auth0OAuth2Adapter } from "../../src/services/oauth2/adapters/auth0.adapter";
import { OAuth2AdapterFactory } from "../../src/services/oauth2/oauth2.factory";
import { OAuth2Error } from "../../src/services/oauth2/oauth2.types";

describe("OAuth2 Adapters (Backing Services)", () => {
    describe("MockOAuth2Adapter", () => {
        const adapter = new MockOAuth2Adapter();

        it("debe estar siempre configurado para entorno local / CI", () => {
            expect(adapter.isConfigured()).toBe(true);
            expect(adapter.provider).toBe("MOCK");
        });

        it("debe generar URL de autorización con state y redirectUri", () => {
            const url = adapter.getAuthorizationUrl({
                state: "state-test-123",
                redirectUri: "http://localhost:3001/callback"
            });

            expect(url).toContain("state=state-test-123");
            expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fcallback");
            expect(url).toContain("response_type=code");
        });

        it("debe intercambiar código válido por tokens exitosamente", async () => {
            const tokens = await adapter.exchangeCodeForTokens({
                code: "mock_auth_code_xyz"
            });

            expect(tokens.accessToken).toBeDefined();
            expect(tokens.tokenType).toBe("Bearer");
            expect(tokens.expiresIn).toBe(3600);
        });

        it("debe rechazar código inválido con error 400", async () => {
            await expect(
                adapter.exchangeCodeForTokens({ code: "invalid_code" })
            ).rejects.toThrowError(OAuth2Error);
        });

        it("debe obtener perfil de identidad del usuario", async () => {
            const tokens = await adapter.exchangeCodeForTokens({ code: "valid_code" });
            const userInfo = await adapter.getUserInfo(tokens);

            expect(userInfo.provider).toBe("MOCK");
            expect(userInfo.id).toBeDefined();
            expect(userInfo.email).toContain("@");
            expect(userInfo.name).toBeDefined();
        });
    });

    describe("GoogleOAuth2Adapter", () => {
        const adapter = new GoogleOAuth2Adapter();

        it("debe tener nombre y proveedor GOOGLE", () => {
            expect(adapter.provider).toBe("GOOGLE");
            expect(adapter.name).toContain("Google");
        });

        it("debe lanzar error 500 al generar URL si faltan credenciales en .env", () => {
            if (!adapter.isConfigured()) {
                expect(() => {
                    adapter.getAuthorizationUrl({ state: "test-state" });
                }).toThrowError(OAuth2Error);
            }
        });
    });

    describe("Auth0OAuth2Adapter", () => {
        const adapter = new Auth0OAuth2Adapter();

        it("debe tener nombre y proveedor AUTH0", () => {
            expect(adapter.provider).toBe("AUTH0");
            expect(adapter.name).toContain("Auth0");
        });

        it("debe lanzar error 500 al canjear código si faltan credenciales en .env", async () => {
            if (!adapter.isConfigured()) {
                await expect(
                    adapter.exchangeCodeForTokens({ code: "dummy_code" })
                ).rejects.toThrowError(OAuth2Error);
            }
        });
    });

    describe("OAuth2AdapterFactory", () => {
        it("debe normalizar proveedores en mayúsculas y minúsculas", () => {
            expect(OAuth2AdapterFactory.normalizeProvider("google")).toBe("GOOGLE");
            expect(OAuth2AdapterFactory.normalizeProvider("AUTH0")).toBe("AUTH0");
            expect(OAuth2AdapterFactory.normalizeProvider("mock")).toBe("MOCK");
        });

        it("debe rechazar proveedores desconocidos con 400", () => {
            expect(() => {
                OAuth2AdapterFactory.normalizeProvider("facebook");
            }).toThrowError(OAuth2Error);
        });

        it("debe retornar listado de proveedores y su estado", () => {
            const providers = OAuth2AdapterFactory.listProviders();
            expect(providers.length).toBeGreaterThanOrEqual(3);
            const mockProv = providers.find(p => p.provider === "MOCK");
            expect(mockProv).toBeDefined();
            expect(mockProv?.configured).toBe(true);
        });
    });
});
