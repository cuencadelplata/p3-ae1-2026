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
    nombre: unknown;
    apellido: unknown;
    dni: unknown;
    telefono: unknown;
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
    const { nombre, apellido, dni, telefono, email, password, rol } = input;

    if (
        typeof nombre !== "string" ||
        typeof apellido !== "string" ||
        typeof dni !== "string" ||
        typeof telefono !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string" ||
        typeof rol !== "string"
    ) {
        throw new AuthError(
            400,
            "Nombre, apellido, DNI, telefono, email, password y rol son obligatorios"
        );
    }

    if (!nombre.trim() || !apellido.trim() || !dni.trim() || !telefono.trim()) {
        throw new AuthError(
            400,
            "Nombre, apellido, DNI y telefono son obligatorios"
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
        nombre.trim(),
        apellido.trim(),
        dni.trim(),
        telefono.trim(),
        emailNormalizado,
        passwordHash,
        rol as UserRole
    );

    return {
        id,
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        dni: dni.trim(),
        telefono: telefono.trim(),
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
            nombre: usuario.nombre,
            apellido: usuario.apellido,
            dni: usuario.dni,
            telefono: usuario.telefono,
            email: usuario.email,
            rol: usuario.rol,
            estado: usuario.estado
        }
    };
}