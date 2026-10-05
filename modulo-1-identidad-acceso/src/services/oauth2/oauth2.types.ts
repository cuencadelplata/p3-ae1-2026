import { OAuth2Provider, UserRole, UserStatus } from "../../types/user.types";

export class OAuth2Error extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly code?: string
    ) {
        super(message);
        this.name = "OAuth2Error";
    }
}

export interface OAuth2Tokens {
    accessToken: string;
    idToken?: string;
    tokenType: string;
    expiresIn?: number;
    refreshToken?: string;
    scope?: string;
}

export interface OAuth2UserInfo {
    provider: OAuth2Provider;
    id: string; // Subject identifier ('sub')
    email: string;
    name?: string;
    givenName?: string;
    familyName?: string;
    picture?: string;
    emailVerified?: boolean;
}

export interface OAuth2StatePayload {
    nonce: string;
    provider: OAuth2Provider;
    role: UserRole;
    redirectUri?: string;
    timestamp: number;
}

export interface OAuth2AuthResponse {
    token: string;
    tokenType: string;
    expiresIn: string;
    usuario: {
        id: number;
        email: string;
        nombre: string;
        apellido: string;
        rol: UserRole;
        estado: UserStatus;
    };
    provider: OAuth2Provider;
}

export interface ProviderStatus {
    provider: OAuth2Provider;
    configured: boolean;
    isDefault: boolean;
    description: string;
}
