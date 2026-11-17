import { OAuth2Provider } from "../../../types/user.types";
import { IOAuth2Adapter, GetAuthUrlOptions, ExchangeCodeOptions } from "./oauth2-adapter.interface";
import { OAuth2Tokens, OAuth2UserInfo, OAuth2Error } from "../oauth2.types";
import { config } from "../../../config/env";

export class Auth0OAuth2Adapter implements IOAuth2Adapter {
    readonly provider: OAuth2Provider = "AUTH0";
    readonly name = "Auth0 (OpenID Connect)";

    private readonly requestTimeoutMs = 8000;

    isConfigured(): boolean {
        return config.auth0.isConfigured;
    }

    private cleanDomain(): string {
        return config.auth0.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }

    getAuthorizationUrl(options: GetAuthUrlOptions): string {
        if (!this.isConfigured()) {
            throw new OAuth2Error(
                500,
                "El proveedor Auth0 no está configurado (faltan AUTH0_DOMAIN / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET en .env)",
                "provider_not_configured"
            );
        }

        const domain = this.cleanDomain();
        const redirectUri = options.redirectUri || config.auth0.redirectUri;
        const scopes = options.scopes || ["openid", "profile", "email"];

        const url = new URL(`https://${domain}/authorize`);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", config.auth0.clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("scope", scopes.join(" "));
        url.searchParams.set("state", options.state);

        if (options.codeChallenge) {
            url.searchParams.set("code_challenge", options.codeChallenge);
            url.searchParams.set("code_challenge_method", options.codeChallengeMethod || "S256");
        }

        return url.toString();
    }

    async exchangeCodeForTokens(options: ExchangeCodeOptions): Promise<OAuth2Tokens> {
        if (!this.isConfigured()) {
            throw new OAuth2Error(500, "Auth0 no está configurado", "provider_not_configured");
        }

        const domain = this.cleanDomain();
        const redirectUri = options.redirectUri || config.auth0.redirectUri;
        const tokenUrl = `https://${domain}/oauth/token`;

        const bodyPayload: Record<string, string> = {
            grant_type: "authorization_code",
            client_id: config.auth0.clientId,
            client_secret: config.auth0.clientSecret,
            code: options.code,
            redirect_uri: redirectUri
        };

        if (options.codeVerifier) {
            bodyPayload.code_verifier = options.codeVerifier;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
            const response = await fetch(tokenUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload),
                signal: controller.signal
            });

            const data = await response.json() as Record<string, unknown>;

            if (!response.ok) {
                const errorDesc = typeof data.error_description === "string"
                    ? data.error_description
                    : "Error al canjear código en Auth0";
                throw new OAuth2Error(400, errorDesc, "auth0_exchange_failed");
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
                throw new OAuth2Error(504, "Tiempo de espera agotado al conectar con Auth0", "gateway_timeout");
            }
            throw new OAuth2Error(502, `Fallo de comunicación con Auth0: ${(error as Error).message}`, "bad_gateway");
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async getUserInfo(tokens: OAuth2Tokens): Promise<OAuth2UserInfo> {
        const domain = this.cleanDomain();
        const userInfoUrl = `https://${domain}/userinfo`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
            const response = await fetch(userInfoUrl, {
                headers: {
                    Authorization: `Bearer ${tokens.accessToken}`
                },
                signal: controller.signal
            });

            if (!response.ok) {
                throw new OAuth2Error(401, "No fue posible validar el token con Auth0 UserInfo", "invalid_token");
            }

            const data = await response.json() as Record<string, unknown>;

            return {
                provider: "AUTH0",
                id: String(data.sub),
                email: String(data.email || ""),
                name: typeof data.name === "string" ? data.name : undefined,
                givenName: typeof data.given_name === "string" ? data.given_name : undefined,
                familyName: typeof data.family_name === "string" ? data.family_name : undefined,
                picture: typeof data.picture === "string" ? data.picture : undefined,
                emailVerified: Boolean(data.email_verified)
            };
        } catch (error) {
            if (error instanceof OAuth2Error) throw error;
            if (error instanceof Error && error.name === "AbortError") {
                throw new OAuth2Error(504, "Timeout al obtener perfil de Auth0", "gateway_timeout");
            }
            throw new OAuth2Error(502, `Error al obtener usuario de Auth0: ${(error as Error).message}`, "bad_gateway");
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
