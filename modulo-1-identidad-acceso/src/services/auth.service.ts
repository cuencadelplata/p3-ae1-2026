import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
    createUser,
    findUserByEmail
} from "../repositories/user.repository";
import { UserRole } from "../types/user.types";

const ROLES_VALIDOS: UserRole[] = [
    "CLIENTE",
    "CONDUCTOR",
    "OPERADOR"
];

export class AuthError extends Error {
    constructor(
        public statusCode: number,
        message: string
    ) {
        super(message);
    }
}

interface RegisterInput {
    email: unknown;
    password: unknown;
    rol: unknown;
}

interface LoginInput {
    email: unknown;
    password: unknown;
}

export async function registerUser(
    input: RegisterInput
) {
    const { email, password, rol } = input;

    if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        typeof rol !== "string"
    ) {
        throw new AuthError(
            400,
            "Email, password y rol son obligatorios"
        );
    }

    const emailNormalizado = email
        .trim()
        .toLowerCase();

    if (!emailNormalizado.includes("@")) {
        throw new AuthError(
            400,
            "El email no es válido"
        );
    }

    if (password.length < 6) {
        throw new AuthError(
            400,
            "La contraseña debe tener al menos 6 caracteres"
        );
    }

    if (!ROLES_VALIDOS.includes(rol as UserRole)) {
        throw new AuthError(
            400,
            "El rol debe ser CLIENTE, CONDUCTOR u OPERADOR"
        );
    }

    const usuarioExistente =
        findUserByEmail(emailNormalizado);

    if (usuarioExistente) {
        throw new AuthError(
            409,
            "Ya existe un usuario con ese email"
        );
    }

    const passwordHash = await bcrypt.hash(
        password,
        10
    );

    const id = createUser(
        emailNormalizado,
        passwordHash,
        rol as UserRole
    );

    return {
        id,
        email: emailNormalizado,
        rol,
        estado: "ACTIVO"
    };
}

export async function loginUser(
    input: LoginInput
) {
    const { email, password } = input;

    if (
        typeof email !== "string" ||
        typeof password !== "string"
    ) {
        throw new AuthError(
            400,
            "Email y password son obligatorios"
        );
    }

    const emailNormalizado = email
        .trim()
        .toLowerCase();

    const usuario =
        findUserByEmail(emailNormalizado);

    if (!usuario) {
        throw new AuthError(
            401,
            "Credenciales incorrectas"
        );
    }

    if (usuario.estado === "BLOQUEADO") {
        throw new AuthError(
            403,
            "Usuario bloqueado"
        );
    }

    const passwordCorrecto = await bcrypt.compare(
        password,
        usuario.password_hash
    );

    if (!passwordCorrecto) {
        throw new AuthError(
            401,
            "Credenciales incorrectas"
        );
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        throw new Error(
            "La variable JWT_SECRET no está configurada"
        );
    }

    const token = jwt.sign(
        {
            userId: usuario.id,
            role: usuario.rol
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
            id: usuario.id,
            email: usuario.email,
            rol: usuario.rol,
            estado: usuario.estado
        }
    };
}