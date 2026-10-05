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
    findUserById
} from "../repositories/user.repository";

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

export async function register(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const usuario = await registerUser(
            req.body
        );

        res.status(201).json(usuario);
    } catch (error) {
        handleError(error, res);
    }
}

export async function login(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const resultado = await loginUser(
            req.body
        );

        res.status(200).json(resultado);
    } catch (error) {
        handleError(error, res);
    }
}

export function validateToken(
    req: AuthenticatedRequest,
    res: Response
): void {
    const userId = req.usuarioAutenticado?.userId;
    const role = req.usuarioAutenticado?.role;
    const authMethod = req.usuarioAutenticado?.authMethod || "password";
    const user = userId ? findUserById(userId) : undefined;

    if (!user) {
        res.status(200).json({
            valid: false,
            userId,
            role,
            authMethod,
            error: "Usuario no encontrado"
        });
        return;
    }

    res.status(200).json({
        valid: user.estado === "ACTIVO",
        userId,
        role,
        authMethod,
        usuario: {
            id: user.id,
            rol: user.rol,
            email: user.email,
            nombre: user.nombre,
            apellido: user.apellido,
            estado: user.estado
        }
    });
}
