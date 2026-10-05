import { OAuth2Provider } from "../../../types/user.types";
import { IOAuth2Adapter, GetAuthUrlOptions, ExchangeCodeOptions } from "./oauth2-adapter.interface";
import { OAuth2Tokens, OAuth2UserInfo, OAuth2Error } from "../oauth2.types";

/**
 * Adaptador Sandbox / Mock para pruebas locales y evaluación académica.
 * Permite ejecutar de extremo a extremo todo el flujo OAuth2/OIDC sin requerir
 * credenciales en la nube ni conexión a internet.
 */
export class MockOAuth2Adapter implements IOAuth2Adapter {
    readonly provider: OAuth2Provider = "MOCK";
    readonly name = "Mock / Sandbox Local IdP";

    isConfigured(): boolean {
        return true;
    }

    getAuthorizationUrl(options: GetAuthUrlOptions): string {
        const redirect = options.redirectUri || "http://localhost:3001/auth/oauth2/callback";
        const url = new URL("http://mock-idp.local/authorize");
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", "mock-client-id");
        url.searchParams.set("redirect_uri", redirect);
        url.searchParams.set("state", options.state);
        url.searchParams.set("scope", (options.scopes || ["openid", "email", "profile"]).join(" "));
        if (options.codeChallenge) {
            url.searchParams.set("code_challenge", options.codeChallenge);
            url.searchParams.set("code_challenge_method", options.codeChallengeMethod || "S256");
        }
        return url.toString();
    }

    async exchangeCodeForTokens(options: ExchangeCodeOptions): Promise<OAuth2Tokens> {
        const { code } = options;

        if (!code || code === "invalid_code") {
            throw new OAuth2Error(400, "Código de autorización OAuth2 inválido o expirado", "invalid_grant");
        }

        if (code === "mock_code_timeout") {
            throw new OAuth2Error(504, "Tiempo de espera agotado al conectar con el proveedor IdP", "gateway_timeout");
        }

        return {
            accessToken: `mock_access_token_${Date.now()}`,
            idToken: `mock_id_token_${Buffer.from(JSON.stringify({ sub: "mock-123" })).toString("base64")}`,
            tokenType: "Bearer",
            expiresIn: 3600,
            scope: "openid email profile"
        };
    }

    async getUserInfo(tokens: OAuth2Tokens): Promise<OAuth2UserInfo> {
        if (!tokens.accessToken) {
            throw new OAuth2Error(401, "Token de acceso inválido", "invalid_token");
        }

        // Permite simular diferentes identidades a partir del token o código
        return {
            provider: "MOCK",
            id: "mock-sub-user-001",
            email: "usuario.oauth2@movilidad-urbana.test",
            name: "Usuario OAuth2 Sandbox",
            givenName: "Usuario",
            familyName: "Sandbox",
            emailVerified: true
        };
    }
}
