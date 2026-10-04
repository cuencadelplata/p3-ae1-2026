import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
    createUser,
    findUserByDni,
    findUserByEmail
} from "../repositories/user.repository";
import {
    esEmailValido,
    esPasswordValida,
    esRolRegistrable,
    normalizarEmail
} from "../utils/auth.validators";

export class AuthError extends Error {
    constructor(
        public statusCode: number,
        message: string
    ) {
        super(message);
    }
}

import { RegisterUserRequestDTO, RegisterUserResponseDTO } from "../types/auth.dto";
import { validateRegisterRequest } from "../utils/validators";

export async function registerUser(
    input: RegisterUserRequestDTO
): Promise<RegisterUserResponseDTO> {
    const { isValid, errors } = validateRegisterRequest(input);

    if (!isValid) {
        throw new AuthError(400, errors.join(", "));
    }

    const { nombre, apellido, dni, telefono, email, password, rol } = input;

    const nombreNormalizado = nombre.trim();
    const apellidoNormalizado = apellido.trim();
    const dniNormalizado = dni.trim();
    const telefonoNormalizado = telefono.trim();
    const emailNormalizado = normalizarEmail(email);

    const usuarioExistente = findUserByEmail(emailNormalizado);
    if (usuarioExistente) {
        throw new AuthError(409, "Ya existe un usuario con ese email");
    }

    const usuarioConDniExistente = findUserByDni(dniNormalizado);
    if (usuarioConDniExistente) {
        throw new AuthError(409, "Ya existe un usuario con ese DNI");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const id = createUser(
        nombreNormalizado,
        apellidoNormalizado,
        dniNormalizado,
        telefonoNormalizado,
        emailNormalizado,
        passwordHash,
        rol
    );

    return {
        id,
        nombre: nombreNormalizado,
        apellido: apellidoNormalizado,
        email: emailNormalizado,
        rol,
        created_at: new Date().toISOString()
    };
}

interface LoginInput {
    email: unknown;
    password: unknown;
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

    const jwtSecret =
        process.env.JWT_SECRET ||
        "clave-local-desarrollo-m1-cambiar-en-produccion";

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