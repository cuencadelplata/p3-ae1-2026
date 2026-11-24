import { Request, Response } from "express";
import { OAuth2Service } from "../services/oauth2/oauth2.service";
import { OAuth2Error } from "../services/oauth2/oauth2.types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import db from "../config/database";
import { createOAuth2ProviderLink, findOAuth2Provider } from "../repositories/user.repository";

function handleError(error: unknown, res: Response): void {
    if (error instanceof OAuth2Error) {
        res.status(error.statusCode).json({
            error: error.message,
            code: error.code
        });
        return;
    }

    console.error("Unhandled OAuth2 error:", error);
    res.status(500).json({
        error: "Error interno del servidor",
        code: "internal_server_error"
    });
}

/**
 * GET /auth/oauth2/providers
 * Lista proveedores soportados y estado de configuración
 */
export function listProviders(req: Request, res: Response): void {
    try {
        const providers = OAuth2Service.getAvailableProviders();
        res.status(200).json({
            providers,
            count: providers.length
        });
    } catch (error) {
        handleError(error, res);
    }
}

/**
 * GET /auth/oauth2/authorize
 * Inicia el flujo OAuth2 y redirige o retorna la URL de autorización
 */
export function oauth2Authorize(req: Request, res: Response): void {
    try {
        const { provider, role, redirect_uri, redirect } = req.query;

        if (!provider || typeof provider !== "string") {
            res.status(400).json({ error: "El parámetro 'provider' es obligatorio (GOOGLE, AUTH0, MOCK)" });
            return;
        }

        const authData = OAuth2Service.initiateAuthorization(
            typeof provider === "string" ? provider : undefined,
            typeof role === "string" ? role : undefined,
            typeof redirect_uri === "string" ? redirect_uri : undefined
        );

        // Si se solicita redirección directa en navegador
        if (redirect === "true" || redirect === "1") {
            res.redirect(302, authData.authorizationUrl);
            return;
        }

        res.status(200).json({
            authorizationUrl: authData.authorizationUrl,
            state: authData.state,
            provider: authData.provider
        });
    } catch (error) {
        handleError(error, res);
    }
}

/**
 * GET & POST /auth/oauth2/callback
 * Procesa el callback del proveedor con code y state
 */
export async function oauth2Callback(req: Request, res: Response): Promise<void> {
    try {
        const provider = (req.query.provider || req.body?.provider || "") as string;
        const code = (req.query.code || req.body?.code || "") as string;
        const state = (req.query.state || req.body?.state || "") as string;
        const redirectUri = (req.query.redirect_uri || req.body?.redirect_uri) as string | undefined;

        const result = await OAuth2Service.handleCallback(
            provider,
            code,
            state,
            redirectUri
        );

        res.status(200).json(result);
    } catch (error) {
        handleError(error, res);
    }
}

/**
 * POST /auth/oauth2/link
 * Vincula un proveedor externo a un usuario existente autenticado
 */
export async function oauth2LinkAccount(req: Request, res: Response): Promise<void> {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.usuarioAutenticado?.userId;

        if (!userId) {
            res.status(401).json({ error: "No autenticado", code: "unauthenticated" });
            return;
        }

        const { provider, code, state, redirect_uri, provider_id } = req.body || {};

        if (provider_id && provider) {
            const existing = findOAuth2Provider(provider, String(provider_id));
            if (!existing) {
                createOAuth2ProviderLink(userId, provider, String(provider_id));
            }
            res.status(200).json({
                message: "Proveedor vinculado exitosamente (AE2)",
                provider,
                provider_id
            });
            return;
        }

        if (!code || !state) {
            res.status(400).json({
                error: "Parámetros 'code' y 'state' requeridos para vincular cuenta",
                code: "missing_parameters"
            });
            return;
        }

        const result = await OAuth2Service.linkProvider(
            userId,
            typeof provider === "string" ? provider : "",
            String(code),
            String(state),
            typeof redirect_uri === "string" ? redirect_uri : undefined
        );

        res.status(200).json(result);
    } catch (error) {
        handleError(error, res);
    }
}

/**
 * GET /auth/oauth2/userinfo
 * Perfil completo del usuario autenticado
 */
export function getUserInfo(req: Request, res: Response): void {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.usuarioAutenticado?.userId;

    if (!userId) {
        res.status(401).json({ error: "Token inválido", code: "invalid_token" });
        return;
    }

    try {
        const user = OAuth2Service.getUserById(userId);
        if (!user) {
            res.status(404).json({ error: "Usuario no encontrado" });
            return;
        }

        const linkedProviders = OAuth2Service.getUserProviders(userId);

        res.status(200).json({
            valid: true,
            usuario: {
                id: user.id,
                email: user.email,
                nombre: user.nombre,
                apellido: user.apellido,
                rol: user.rol,
                estado: user.estado
            },
            authMethod: "oauth2",
            linkedProviders: linkedProviders.map(p => ({
                provider: p.provider_name,
                email: p.provider_email,
                linkedAt: p.created_at,
                lastLoginAt: p.last_login_at
            }))
        });
    } catch (error) {
        handleError(error, res);
    }
}
