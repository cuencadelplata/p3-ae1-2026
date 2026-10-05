import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../../config/env";
import { OAuth2Provider, UserRole, UserRow } from "../../types/user.types";
import {
    findUserById,
    findUserByEmail,
    createOAuth2User,
    findOAuth2Provider,
    findOAuth2ProvidersByUserId,
    createOAuth2ProviderLink,
    updateOAuth2LastLogin
} from "../../repositories/user.repository";
import { OAuth2AdapterFactory } from "./oauth2.factory";
import {
    OAuth2Error,
    OAuth2AuthResponse,
    OAuth2StatePayload,
    ProviderStatus
} from "./oauth2.types";

export class OAuth2Service {
    /**
     * Genera un state firmado criptogrÃ¡ficamente para prevenir CSRF (RFC 6749)
     */
    static generateState(
        provider: OAuth2Provider,
        role: UserRole = "CLIENTE",
        redirectUri?: string,
        codeVerifier?: string
    ): string {
        const payload = {
            nonce: crypto.randomBytes(16).toString("hex"),
            provider,
            role,
            redirectUri,
            codeVerifier,
            timestamp: Date.now()
        };

        return jwt.sign(payload, config.jwtSecret, { expiresIn: "10m" });
    }

    /**
     * Valida y decodifica el state recibido en el callback
     */
    static verifyState(stateToken: string): OAuth2StatePayload & { codeVerifier?: string } {
        try {
            const decoded = jwt.verify(stateToken, config.jwtSecret) as OAuth2StatePayload & {
                codeVerifier?: string;
            };
            return decoded;
        } catch {
            throw new OAuth2Error(
                400,
                "ParÃ¡metro 'state' invÃ¡lido o expirado. Posible ataque CSRF.",
                "invalid_state"
            );
        }
    }

    /**
     * Genera parÃ¡metros para flujo PKCE (RFC 7636)
     */
    static generatePKCE(): { codeVerifier: string; codeChallenge: string } {
        const codeVerifier = crypto.randomBytes(32).toString("base64url");
        const codeChallenge = crypto
            .createHash("sha256")
            .update(codeVerifier)
            .digest("base64url");
        return { codeVerifier, codeChallenge };
    }

    /**
     * Inicia el flujo de autorizaciÃ³n OAuth2/OIDC
     */
    static initiateAuthorization(
        rawProvider?: string,
        rawRole?: string,
        redirectUri?: string
    ): {
        authorizationUrl: string;
        state: string;
        provider: OAuth2Provider;
        codeVerifier: string;
    } {
        const adapter = OAuth2AdapterFactory.getAdapter(rawProvider);
        const role = this.normalizeRole(rawRole);
        const { codeVerifier, codeChallenge } = this.generatePKCE();

        const state = this.generateState(
            adapter.provider,
            role,
            redirectUri,
            codeVerifier
        );

        const authorizationUrl = adapter.getAuthorizationUrl({
            state,
            redirectUri,
            codeChallenge,
            codeChallengeMethod: "S256"
        });

        return {
            authorizationUrl,
            state,
            provider: adapter.provider,
            codeVerifier
        };
    }

    /**
     * Procesa el callback de OAuth2 tras la redirecciÃ³n del proveedor
     */
    static async handleCallback(
        rawProvider: string,
        code: string,
        stateToken: string,
        overrideRedirectUri?: string
    ): Promise<OAuth2AuthResponse> {
        if (!code) {
            throw new OAuth2Error(400, "El cÃ³digo de autorizaciÃ³n ('code') es requerido", "missing_code");
        }

        if (!stateToken) {
            throw new OAuth2Error(400, "El parÃ¡metro 'state' es requerido para validar CSRF", "missing_state");
        }

        // 1. Validar State y CSRF
        const statePayload = this.verifyState(stateToken);

        const adapter = OAuth2AdapterFactory.getAdapter(rawProvider || statePayload.provider);

        // 2. Intercambiar code por tokens con el IdP Backing Service
        const tokens = await adapter.exchangeCodeForTokens({
            code,
            redirectUri: overrideRedirectUri || statePayload.redirectUri,
            codeVerifier: statePayload.codeVerifier
        });

        // 3. Obtener perfil de identidad validado del usuario desde el IdP
        const userInfo = await adapter.getUserInfo(tokens);

        if (!userInfo.email) {
            throw new OAuth2Error(
                400,
                "El proveedor de identidad no suministrÃ³ una direcciÃ³n de correo electrÃ³nico",
                "missing_email"
            );
        }

        // 4. Buscar usuario vinculado o crearlo en la persistencia local
        let user: UserRow;
        const existingProviderLink = findOAuth2Provider(adapter.provider, userInfo.id);

        if (existingProviderLink) {
            // Usuario ya vinculado
            const foundUser = findUserById(existingProviderLink.usuario_id);
            if (!foundUser) {
                throw new OAuth2Error(500, "Usuario vinculado no encontrado en la base de datos", "user_not_found");
            }
            user = foundUser;
            updateOAuth2LastLogin(existingProviderLink.id);
        } else {
            // Buscar si ya existe un usuario con este email registrado
            const existingUserByEmail = findUserByEmail(userInfo.email);

            if (existingUserByEmail) {
                user = existingUserByEmail;
            } else {
                // Crear nuevo usuario local con el rol solicitado en el state
                const nombre = userInfo.givenName || userInfo.name || "";
                const apellido = userInfo.familyName || "";
                const newUserId = createOAuth2User(
                    userInfo.email,
                    statePayload.role || "CLIENTE",
                    nombre,
                    apellido
                );
                const createdUser = findUserById(newUserId);
                if (!createdUser) {
                    throw new OAuth2Error(500, "Error al persistir usuario local", "db_error");
                }
                user = createdUser;
            }

            // Vincular proveedor a usuario
            createOAuth2ProviderLink(user.id, adapter.provider, userInfo.id, userInfo.email);
        }

        // 5. Validar estado del usuario (RNF: bloqueo de acceso)
        if (user.estado === "BLOQUEADO") {
            throw new OAuth2Error(
                403,
                "Usuario bloqueado en el sistema. Contacte al administrador.",
                "user_blocked"
            );
        }

        // 6. Generar ticket / JWT interno del sistema para interoperabilidad con los demÃ¡s mÃ³dulos
        const internalToken = this.generateSystemToken(user, adapter.provider);

        return {
            token: internalToken,
            tokenType: "Bearer",
            expiresIn: config.jwtExpiresIn,
            usuario: {
                id: user.id,
                email: user.email,
                nombre: user.nombre,
                apellido: user.apellido,
                rol: user.rol,
                estado: user.estado
            },
            provider: adapter.provider
        };
    }

    /**
     * Vincula un proveedor OAuth2 a una cuenta existente ya autenticada
     */
    static async linkProvider(
        userId: number,
        rawProvider: string,
        code: string,
        stateToken: string,
        overrideRedirectUri?: string
    ): Promise<{ message: string; provider: OAuth2Provider; email: string }> {
        const currentUser = findUserById(userId);
        if (!currentUser) {
            throw new OAuth2Error(404, "Usuario actual no encontrado", "user_not_found");
        }

        if (currentUser.estado === "BLOQUEADO") {
            throw new OAuth2Error(403, "Usuario bloqueado. No puede vincular proveedores.", "user_blocked");
        }

        const statePayload = this.verifyState(stateToken);
        const adapter = OAuth2AdapterFactory.getAdapter(rawProvider || statePayload.provider);

        const tokens = await adapter.exchangeCodeForTokens({
            code,
            redirectUri: overrideRedirectUri || statePayload.redirectUri,
            codeVerifier: statePayload.codeVerifier
        });

        const userInfo = await adapter.getUserInfo(tokens);

        // Verificar si este provider_user_id ya estÃ¡ enlazado a otra cuenta distinta
        const existingLink = findOAuth2Provider(adapter.provider, userInfo.id);
        if (existingLink) {
            if (existingLink.usuario_id === userId) {
                return {
                    message: "El proveedor ya se encuentra vinculado a esta cuenta.",
                    provider: adapter.provider,
                    email: userInfo.email
                };
            }
            throw new OAuth2Error(
                409,
                `Esta cuenta de ${adapter.name} ya estÃ¡ asociada a otro usuario.`,
                "provider_already_linked"
            );
        }

        createOAuth2ProviderLink(userId, adapter.provider, userInfo.id, userInfo.email);

        return {
            message: `Cuenta de ${adapter.name} vinculada exitosamente.`,
            provider: adapter.provider,
            email: userInfo.email
        };
    }

    /**
     * Valida el ticket JWT emitido y recupera la identidad y rol para otros mÃ³dulos (M2, M3, M5, M6)
     */
    static validateIdentityAndRole(jwtToken: string): {
        valid: boolean;
        usuario: {
            id: number;
            email: string;
            nombre: string;
            apellido: string;
            rol: UserRole;
            estado: string;
        };
        authMethod: string;
        provider: OAuth2Provider;
    } {
        try {
            const decoded = jwt.verify(jwtToken, config.jwtSecret) as {
                userId: number;
                email: string;
                role: UserRole;
                authMethod: string;
                provider: OAuth2Provider;
            };

            const user = findUserById(decoded.userId);
            if (!user) {
                throw new OAuth2Error(401, "El usuario asociado al token no existe", "user_not_found");
            }

            if (user.estado === "BLOQUEADO") {
                throw new OAuth2Error(403, "Usuario bloqueado en el sistema", "user_blocked");
            }

            return {
                valid: true,
                usuario: {
                    id: user.id,
                    email: user.email,
                    nombre: user.nombre,
                    apellido: user.apellido,
                    rol: user.rol,
                    estado: user.estado
                },
                authMethod: decoded.authMethod,
                provider: decoded.provider
            };
        } catch (error) {
            if (error instanceof OAuth2Error) throw error;
            throw new OAuth2Error(401, "Token de acceso invÃ¡lido o expirado", "invalid_token");
        }
    }

    /**
     * Retorna los proveedores vinculados de un usuario
     */
    static getUserProviders(userId: number) {
        return findOAuth2ProvidersByUserId(userId);
    }

    /**
     * Lista los proveedores soportados y su estado de configuraciÃ³n
     */
    static getUserById(userId: number): UserRow | undefined {
        return findUserById(userId);
    }

    static getAvailableProviders(): ProviderStatus[] {
        return OAuth2AdapterFactory.listProviders();
    }

    private static generateSystemToken(user: UserRow, provider: OAuth2Provider): string {
        return jwt.sign(
            {
                userId: user.id,
                email: user.email,
                role: user.rol,
                authMethod: "oauth2",
                provider
            },
            config.jwtSecret,
            { expiresIn: "1h" }
        );
    }

    private static normalizeRole(rawRole?: string): UserRole {
        if (!rawRole) return "CLIENTE";
        const upper = rawRole.trim().toUpperCase();
        if (upper === "CONDUCTOR" || upper === "OPERADOR") {
            return upper as UserRole;
        }
        return "CLIENTE";
    }
}

