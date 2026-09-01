import {
    Request,
    Response
} from "express";

import {
    AuthError,
    loginUser
} from "../services/auth.service";

import {
    requestPasswordRecovery,
    resetPassword
} from "../services/password-recovery.service";

import {
    handleOAuth2Callback,
    validateOAuth2Provider
} from "../services/oauth2.service";

function handleError(
    error: unknown,
    res: Response
): void {
    if (error instanceof AuthError) {
        res.status(error.statusCode).json({
            error: error.message
        });
        return;
    }

    console.error(error);

    res.status(500).json({
        error: "Error interno del servidor"
    });
}

/**
 * RF-1.4: POST /auth/solicitar-recuperacion
 * Solicita un token para recuperar la contraseña
 */
export function requestRecovery(
    req: Request,
    res: Response
): void {
    try {
        const { email } = req.body;

        if (typeof email !== "string") {
            res.status(400).json({
                error: "Email es obligatorio"
            });
            return;
        }

        const resultado =
            requestPasswordRecovery(email);

        res.status(200).json(resultado);
    } catch (error) {
        handleError(error, res);
    }
}

/**
 * RF-1.4: POST /auth/resetear-contrasena
 * Resetea la contraseña con un token válido
 */
export async function resetPasswordHandler(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const resultado = await resetPassword(
            req.body
        );

        res.status(200).json(resultado);
    } catch (error) {
        handleError(error, res);
    }
}

/**
 * RF-1.5: GET /auth/oauth2/authorize
 * Inicia flujo de autorización OAuth2 (stub)
 * 
 * Parámetros query:
 *   - provider: GOOGLE | GITHUB | MICROSOFT | CUSTOM
 *   - redirect_uri: URI para callback (validar en producción)
 *   - scopes: (opcional) scopes personalizados
 */
export function oauth2Authorize(
    req: Request,
    res: Response
): void {
    try {
        const { provider, redirect_uri } = req.query;

        if (typeof provider !== "string") {
            res.status(400).json({
                error: "Provider es obligatorio (GOOGLE|GITHUB|MICROSOFT|CUSTOM)"
            });
            return;
        }

        if (typeof redirect_uri !== "string") {
            res.status(400).json({
                error: "redirect_uri es obligatorio"
            });
            return;
        }

        validateOAuth2Provider(provider);

        // En producción:
        // - Generar state token para CSRF
        // - Generar code_challenge para PKCE
        // - Guardar state en sesión
        // - Redirigir a authorization endpoint del provider

        res.status(501).json({
            error: "OAuth2 flow not yet implemented",
            message: "RF-1.5: Este es un stub de contrato para OAuth2/OpenID Connect",
            provider,
            redirect_uri,
            availableProviders: [
                "GOOGLE",
                "GITHUB",
                "MICROSOFT",
                "CUSTOM"
            ],
            evolutionPlan: {
                phase1: "Implementar flujo OAuth2 authorization code",
                phase2: "Agregar validación de ID tokens",
                phase3: "Persistencia de refresh tokens",
                phase4: "Sincronización de perfiles de proveedores",
                timeline: "AE2 - Versión 2.0"
            }
        });
    } catch (error) {
        if (error instanceof AuthError) {
            res.status(error.statusCode).json({
                error: error.message
            });
        } else {
            console.error(error);
            res.status(500).json({
                error: "Error interno del servidor"
            });
        }
    }
}

/**
 * RF-1.5: GET /auth/oauth2/callback
 * Callback handler desde OAuth2 provider (stub)
 * 
 * Parámetros query:
 *   - code: authorization code del provider
 *   - state: state parameter para validar CSRF
 *   - provider: provider que redirige (GOOGLE|GITHUB|MICROSOFT|CUSTOM)
 */
export async function oauth2Callback(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const { code, state, provider } = req.query;

        if (
            typeof provider !== "string" ||
            typeof code !== "string"
        ) {
            res.status(400).json({
                error: "Provider y code son obligatorios"
            });
            return;
        }

        validateOAuth2Provider(provider);

        // En producción:
        // - Validar state token contra sesión (CSRF protection)
        // - Canjear code por access token
        // - Validar firma de ID token
        // - Crear o recuperar usuario
        // - Generar JWT

        res.status(501).json({
            error: "OAuth2 callback not yet implemented",
            message: "RF-1.5: Este es un stub de contrato para OAuth2/OpenID Connect",
            received: {
                provider,
                code: code ? "***[redacted]***" : undefined,
                state: state ? "***[redacted]***" : undefined
            },
            nextSteps: {
                step1: "Validar code contra provider",
                step2: "Obtener ID token y access token",
                step3: "Validar firma del ID token",
                step4: "Crear o vincular usuario",
                step5: "Emitir JWT interno"
            }
        });
    } catch (error) {
        if (error instanceof AuthError) {
            res.status(error.statusCode).json({
                error: error.message
            });
        } else {
            console.error(error);
            res.status(500).json({
                error: "Error interno del servidor"
            });
        }
    }
}

/**
 * RF-1.5: POST /auth/oauth2/link
 * Vincula una cuenta OAuth2 existente a usuario autenticado (stub)
 * 
 * Esta funcionalidad permite que un usuario que se registró con email/password
 * vincule posteriormente una cuenta OAuth2.
 */
export async function oauth2LinkAccount(
    req: Request,
    res: Response
): Promise<void> {
    res.status(501).json({
        error: "OAuth2 account linking not yet implemented",
        message: "Funcionalidad planeada para AE2",
        description: "Permitir vincular cuentas OAuth2 a usuarios existentes",
        timeline: "Versión 2.0"
    });
}
