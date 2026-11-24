import { describe, it, expect } from "vitest";
import { OAuth2Service } from "../../src/services/oauth2/oauth2.service";
import { OAuth2Error } from "../../src/services/oauth2/oauth2.types";

describe("OAuth2Service (Criptografía y Flujo Base)", () => {
    it("debe generar parámetros PKCE válidos (code_verifier y code_challenge)", () => {
        const { codeVerifier, codeChallenge } = OAuth2Service.generatePKCE();

        expect(codeVerifier).toBeDefined();
        expect(codeVerifier.length).toBeGreaterThan(20);
        expect(codeChallenge).toBeDefined();
        expect(codeChallenge.length).toBeGreaterThan(20);
        expect(codeVerifier).not.toBe(codeChallenge);
    });

    it("debe generar un token state firmado y validarlo exitosamente", () => {
        const state = OAuth2Service.generateState("MOCK", "CONDUCTOR", "http://localhost/callback");
        const payload = OAuth2Service.verifyState(state);

        expect(payload.provider).toBe("MOCK");
        expect(payload.role).toBe("CONDUCTOR");
        expect(payload.redirectUri).toBe("http://localhost/callback");
        expect(payload.nonce).toBeDefined();
    });

    it("debe rechazar un state alterado con error 400 (Anti-CSRF)", () => {
        const validState = OAuth2Service.generateState("MOCK", "CLIENTE");
        const tamperedState = validState.slice(0, -5) + "abcde";

        expect(() => {
            OAuth2Service.verifyState(tamperedState);
        }).toThrowError(OAuth2Error);
    });

    it("debe iniciar autorización retornando authorizationUrl, state y verifier", () => {
        const authData = OAuth2Service.initiateAuthorization("MOCK", "CONDUCTOR");

        expect(authData.authorizationUrl).toContain("state=");
        expect(authData.state).toBeDefined();
        expect(authData.provider).toBe("MOCK");
        expect(authData.codeVerifier).toBeDefined();
    });
});

describe("OAuth2Service: rol que se puede pedir por OAuth2", () => {
    function rolDelState(rawRole?: string): string | undefined {
        const { state } = OAuth2Service.initiateAuthorization("MOCK", rawRole);
        return OAuth2Service.verifyState(state).role;
    }

    it("acepta CLIENTE y CONDUCTOR, sin importar mayúsculas ni espacios", () => {
        expect(rolDelState("CLIENTE")).toBe("CLIENTE");
        expect(rolDelState(" conductor ")).toBe("CONDUCTOR");
    });

    it("sin rol o con un rol desconocido usa CLIENTE", () => {
        expect(rolDelState()).toBe("CLIENTE");
        expect(rolDelState("ADMIN")).toBe("CLIENTE");
    });

    it("rechaza OPERADOR con 400 invalid_role (en cualquier variante de mayúsculas)", () => {
        for (const rol of ["OPERADOR", "operador", " Operador "]) {
            let error: unknown;
            try {
                OAuth2Service.initiateAuthorization("MOCK", rol);
            } catch (e) {
                error = e;
            }
            expect(error).toBeInstanceOf(OAuth2Error);
            expect((error as OAuth2Error).statusCode).toBe(400);
            expect((error as OAuth2Error).code).toBe("invalid_role");
        }
    });
});
