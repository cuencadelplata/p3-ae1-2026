import { OAuth2Provider } from "../../../types/user.types";
import { OAuth2Tokens, OAuth2UserInfo } from "../oauth2.types";

export interface GetAuthUrlOptions {
    state: string;
    redirectUri?: string;
    codeChallenge?: string;
    codeChallengeMethod?: "S256" | "plain";
    scopes?: string[];
}

export interface ExchangeCodeOptions {
    code: string;
    redirectUri?: string;
    codeVerifier?: string;
}

export interface IOAuth2Adapter {
    readonly provider: OAuth2Provider;
    readonly name: string;

    /**
     * Indica si el adaptador cuenta con credenciales completas configuradas
     */
    isConfigured(): boolean;

    /**
     * Construye la URL de autorización para redirigir al usuario al proveedor externo
     */
    getAuthorizationUrl(options: GetAuthUrlOptions): string;

    /**
     * Intercambia el código de autorización ('code') por tokens con el IdP
     */
    exchangeCodeForTokens(options: ExchangeCodeOptions): Promise<OAuth2Tokens>;

    /**
     * Obtiene el perfil del usuario autenticado desde el proveedor (OpenID Connect / UserInfo)
     */
    getUserInfo(tokens: OAuth2Tokens): Promise<OAuth2UserInfo>;
}
