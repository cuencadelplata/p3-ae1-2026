import {
    NextFunction,
    Request,
    Response
} from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "../types/user.types";

export interface AuthenticatedRequest
    extends Request {
    usuarioAutenticado?: {
        userId: number;
        role: UserRole;
    };
}

export function authenticateToken(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    const authorization =
        req.headers.authorization;

    if (!authorization) {
        res.status(401).json({
            valid: false,
            error: "Token requerido"
        });
        return;
    }

    const partes = authorization.split(" ");

    if (
        partes.length !== 2 ||
        partes[0] !== "Bearer" ||
        !partes[1]
    ) {
        res.status(401).json({
            valid: false,
            error: "Formato de token incorrecto"
        });
        return;
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        res.status(500).json({
            valid: false,
            error: "JWT_SECRET no está configurado"
        });
        return;
    }

    try {
        const decoded = jwt.verify(
            partes[1],
            jwtSecret
        );

        if (
            typeof decoded === "string" ||
            typeof decoded.userId !== "number" ||
            typeof decoded.role !== "string"
        ) {
            res.status(401).json({
                valid: false,
                error: "Contenido del token inválido"
            });
            return;
        }

        req.usuarioAutenticado = {
            userId: decoded.userId,
            role: decoded.role as UserRole
        };

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            res.status(401).json({
                valid: false,
                error: "Token expirado"
            });
            return;
        }

        res.status(401).json({
            valid: false,
            error: "Token inválido"
        });
    }
}