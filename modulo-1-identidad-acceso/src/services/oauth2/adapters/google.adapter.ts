import { OAuth2Provider } from "../../../types/user.types";
import { IOAuth2Adapter, GetAuthUrlOptions, ExchangeCodeOptions } from "./oauth2-adapter.interface";
import { OAuth2Tokens, OAuth2UserInfo, OAuth2Error } from "../oauth2.types";
import { config } from "../../../config/env";

export class GoogleOAuth2Adapter implements IOAuth2Adapter {
    readonly provider: OAuth2Provider = "GOOGLE";
    readonly name = "Google Identity (OpenID Connect)";

    private readonly authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    private readonly tokenEndpoint = "https://oauth2.googleapis.com/token";
    private readonly userInfoEndpoint = "https://www.googleapis.com/oauth2/v3/userinfo";
    private readonly requestTimeoutMs = 8000;

    isConfigured(): boolean {
        return config.google.isConfigured;
    }

    getAuthorizationUrl(options: GetAuthUrlOptions): string {
        if (!this.isConfigured()) {
            throw new OAuth2Error(
                500,
                "El proveedor Google Identity no está configurado (faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en .env)",
                "provider_not_configured"
            );
        }

        const redirectUri = options.redirectUri || config.google.redirectUri;
        const scopes = options.scopes || ["openid", "email", "profile"];

        const url = new URL(this.authEndpoint);
        url.searchParams.set("client_id", config.google.clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", scopes.join(" "));
        url.searchParams.set("state", options.state);
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "select_account");

        if (options.codeChallenge) {
            url.searchParams.set("code_challenge", options.codeChallenge);
            url.searchParams.set("code_challenge_method", options.codeChallengeMethod || "S256");
        }

        return url.toString();
    }

    async exchangeCodeForTokens(options: ExchangeCodeOptions): Promise<OAuth2Tokens> {
        if (!this.isConfigured()) {
            throw new OAuth2Error(500, "Google Identity no está configurado", "provider_not_configured");
        }

        const redirectUri = options.redirectUri || config.google.redirectUri;
        const params = new URLSearchParams();
        params.set("code", options.code);
        params.set("client_id", config.google.clientId);
        params.set("client_secret", config.google.clientSecret);
        params.set("redirect_uri", redirectUri);
        params.set("grant_type", "authorization_code");

        if (options.codeVerifier) {
            params.set("code_verifier", options.codeVerifier);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
            const response = await fetch(this.tokenEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString(),
                signal: controller.signal
            });

            const data = await response.json() as Record<string, unknown>;

            if (!response.ok) {
                const errorDesc = typeof data.error_description === "string"
                    ? data.error_description
                    : "Error al intercambiar código con Google";
                throw new OAuth2Error(400, errorDesc, "google_exchange_failed");
            }

            return {
                accessToken: String(data.access_token),
                idToken: data.id_token ? String(data.id_token) : undefined,
                tokenType: String(data.token_type || "Bearer"),
                expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
                refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
                scope: data.scope ? String(data.scope) : undefined
            };
        } catch (error) {
            if (error instanceof OAuth2Error) throw error;
            if (error instanceof Error && error.name === "AbortError") {
                throw new OAuth2Error(504, "Tiempo de espera agotado al conectar con Google OAuth2", "gateway_timeout");
            }
            throw new OAuth2Error(502, `Fallo de comunicación con Google: ${(error as Error).message}`, "bad_gateway");
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async getUserInfo(tokens: OAuth2Tokens): Promise<OAuth2UserInfo> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
            const response = await fetch(this.userInfoEndpoint, {
                headers: {
                    Authorization: `Bearer ${tokens.accessToken}`
                },
                signal: controller.signal
            });

            if (!response.ok) {
                throw new OAuth2Error(401, "No fue posible validar el token con Google UserInfo", "invalid_token");
            }

            const data = await response.json() as Record<string, unknown>;

            return {
                provider: "GOOGLE",
                id: String(data.sub),
                email: String(data.email),
                name: typeof data.name === "string" ? data.name : undefined,
                givenName: typeof data.given_name === "string" ? data.given_name : undefined,
                familyName: typeof data.family_name === "string" ? data.family_name : undefined,
                picture: typeof data.picture === "string" ? data.picture : undefined,
                emailVerified: Boolean(data.email_verified)
            };
        } catch (error) {
            if (error instanceof OAuth2Error) throw error;
            if (error instanceof Error && error.name === "AbortError") {
                throw new OAuth2Error(504, "Timeout al obtener perfil de Google", "gateway_timeout");
            }
            throw new OAuth2Error(502, `Error al obtener usuario de Google: ${(error as Error).message}`, "bad_gateway");
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
