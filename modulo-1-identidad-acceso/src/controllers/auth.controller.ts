import {
    Request,
    Response
} from "express";

import {
    AuthError,
    loginUser,
    registerUser
} from "../services/auth.service";

import {
    AuthenticatedRequest
} from "../middleware/auth.middleware";

import {
    obtenerIpCliente
} from "../middleware/login-rate-limit.middleware";

import {
    MAX_INTENTOS_FALLIDOS,
    VENTANA_SEGUNDOS,
    registrarIntentoFallido,
    reiniciarIntentos
} from "../services/login-attempts.service";

import {
    publicarIpBloqueada,
    publicarLoginExitoso
} from "../messaging/auth.publisher";

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

import { RegisterUserRequestDTO } from "../types/auth.dto";

export async function register(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const input: RegisterUserRequestDTO = req.body;
        const usuario = await registerUser(input);

        res.status(201).json(usuario);
    } catch (error) {
        handleError(error, res);
    }
}

async function contarIntentoFallido(ip: string): Promise<void> {
    try {
        const intentos = await registrarIntentoFallido(ip);

        // Justo cuando llega al límite, se avisa a los demás módulos (asincrónico).
        if (intentos === MAX_INTENTOS_FALLIDOS) {
            publicarIpBloqueada(ip, intentos, VENTANA_SEGUNDOS);
        }
    } catch (error) {
        console.error(
            "[Rate limit] No se pudo registrar el intento fallido:",
            (error as Error).message
        );
    }
}

export async function login(
    req: Request,
    res: Response
): Promise<void> {
    const ip = obtenerIpCliente(req);

    try {
        const resultado = await loginUser(
            req.body
        );

        // Login correcto: se limpia el contador de fallos de esa IP.
        await reiniciarIntentos(ip).catch(() => {});

        // Evento asincrónico: no se espera la respuesta de RabbitMQ.
        publicarLoginExitoso(
            resultado.usuario.id,
            resultado.usuario.rol
        );

        res.status(200).json(resultado);
    } catch (error) {
        // Solo cuentan las credenciales incorrectas (401).
        if (
            error instanceof AuthError &&
            error.statusCode === 401
        ) {
            await contarIntentoFallido(ip);
        }

        handleError(error, res);
    }
}

export function validateToken(
    req: AuthenticatedRequest,
    res: Response
): void {
    res.status(200).json({
        valid: true,
        userId: req.usuarioAutenticado?.userId,
        role: req.usuarioAutenticado?.role
    });
}
