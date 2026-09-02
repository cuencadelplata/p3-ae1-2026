import {
    createUser,
    findOAuth2ProviderByProviderUserId,
    createOAuth2Provider,
    findUserById
} from "../repositories/user.repository";
import { UserRole, OAuth2Provider } from "../types/user.types";
import { AuthError } from "./auth.service";
import jwt from "jsonwebtoken";

/**
 * RF-1.5: Integración Estándar
 * 
 * Contrato para integración con proveedores OAuth2/OpenID Connect
 * 
 * Esta es una implementación de stub que define la interfaz para
 * soportar proveedores OAuth2 estándares (Google, GitHub, Microsoft, etc.)
 * 
 * Evolución esperada:
 * - Implementar real OAuth2 authorization flow
 * - Agregar validación de signatures de ID tokens
 * - Persistencia de refresh tokens
 * - Sincronización de perfiles desde proveedores
 */

export interface OAuth2UserInfo {
    provider: OAuth2Provider;
    id: string;
    email: string;
    name?: string;
    picture?: string;
}

export interface OAuth2TokenResponse {
    token: string;
    tokenType: string;
    expiresIn: string;
    usuario: {
        id: number;
        email: string;
        rol: UserRole;
        estado: string;
    };
}

/**
 * Callback handler para OAuth2 providers
 * 
 * Endpoint: GET /auth/oauth2/callback
 * Parámetros esperados:
 *   - provider: OAuth2Provider (GOOGLE, GITHUB, MICROSOFT)
 *   - code: authorization code from provider
 *   - state: state parameter for CSRF protection
 * 
 * Validaciones:
 *   - Verificar state token contra sesión
 *   - Canjear code por access token con provider
 *   - Validar firma de ID token si aplica
 *   - Crear o vincular usuario existente
 */
export async function handleOAuth2Callback(
    userInfo: OAuth2UserInfo
): Promise<OAuth2TokenResponse> {
    if (
        !userInfo.provider ||
        !userInfo.id ||
        !userInfo.email
    ) {
        throw new AuthError(
            400,
            "Información de OAuth2 incompleta"
        );
    }

    // Buscar si el usuario ya tiene vinculado este provider
    let oauthProvider =
        findOAuth2ProviderByProviderUserId(
            userInfo.provider,
            userInfo.id
        );

    if (oauthProvider) {
        // Usuario existente con este provider
        const usuario = findUserById(
            oauthProvider.usuario_id
        );

        if (!usuario) {
            throw new AuthError(
                500,
                "Error al recuperar usuario"
            );
        }

        return generateOAuth2Token(
            usuario.id,
            usuario.email,
            usuario.rol
        );
    }

    // Crear nuevo usuario con este provider
    const defaultRole: UserRole = "CLIENTE";

    // Generar contraseña aleatoria (OAuth2 no la usa)
    const randomPassword = Math.random()
        .toString(36)
        .substring(2);

    const usuarioId = createUser(
        "",
        "",
        "",
        "",
        userInfo.email,
        randomPassword,
        defaultRole
    );

    // Vincular el provider OAuth2 al usuario
    createOAuth2Provider(
        usuarioId,
        userInfo.provider,
        userInfo.id,
        userInfo.email
    );

    return generateOAuth2Token(
        usuarioId,
        userInfo.email,
        defaultRole
    );
}

/**
 * Genera un JWT token después de autenticación OAuth2
 */
function generateOAuth2Token(
    userId: number,
    email: string,
    role: UserRole
): OAuth2TokenResponse {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        throw new Error(
            "JWT_SECRET no está configurado"
        );
    }

    const token = jwt.sign(
        {
            userId,
            role,
            email,
            authMethod: "oauth2"
        },
        jwtSecret,
        {
            expiresIn: "1h"
        }
    );

    return {
        token,
        tokenType: "Bearer",
        expiresIn: "1h",
        usuario: {
            id: userId,
            email,
            rol: role,
            estado: "ACTIVO"
        }
    };
}

/**
 * Valida que el provider y parámetros OAuth2 sean válidos
 * 
 * En evolución:
 * - Validar contra configuración del provider
 * - Verificar que el provider está habilitado
 * - Validar PKCE flow parameters
 */
export function validateOAuth2Provider(
    provider: string
): OAuth2Provider {
    const validProviders = [
        "GOOGLE",
        "GITHUB",
        "MICROSOFT",
        "CUSTOM"
    ];

    if (!validProviders.includes(provider)) {
        throw new AuthError(
            400,
            `Provider ${provider} no soportado`
        );
    }

    return provider as OAuth2Provider;
}

/**
 * Interfaz para validación de ID token (stub)
 * 
 * Implementación esperada:
 * - Obtener public key del provider
 * - Validar firma del token
 * - Validar no_nonce
 * - Validar aud (audience)
 * - Validar iat (issued at) e exp (expiration)
 */
export interface OAuth2IDTokenValidator {
    provider: OAuth2Provider;
    validate(idToken: string): Promise<OAuth2UserInfo>;
}

/**
 * Interfaz para autorización OAuth2 (stub)
 * 
 * Implementación esperada:
 * - Generar state token para CSRF
 * - Generar code_challenge para PKCE
 * - Construir URL de autorización
 * - Guardar state en sessión/Redis
 */
export interface OAuth2AuthorizationFlow {
    provider: OAuth2Provider;
    generateAuthorizationUrl(
        redirectUri: string,
        scopes?: string[]
    ): string;
    exchangeCodeForToken(
        code: string,
        redirectUri: string
    ): Promise<OAuth2UserInfo>;
}
