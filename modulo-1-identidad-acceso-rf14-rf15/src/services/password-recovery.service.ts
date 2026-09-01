import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
    findUserByEmail,
    findUserById,
    createPasswordRecoveryToken,
    findRecoveryTokenByToken,
    markRecoveryTokenAsUsed,
    updateUserPassword
} from "../repositories/user.repository";
import { AuthError } from "./auth.service";

const TOKEN_EXPIRATION_MINUTES = 30;
const TOKEN_LENGTH = 32;

/**
 * RF-1.4: Recuperación y Permiso
 * Genera un token de recuperación de contraseña para un usuario
 * El token es válido por 30 minutos
 */
export function requestPasswordRecovery(
    email: string
): {
    message: string;
    email: string;
    expiresInMinutes: number;
} {
    const emailNormalizado = email
        .trim()
        .toLowerCase();

    if (!emailNormalizado.includes("@")) {
        throw new AuthError(
            400,
            "Email inválido"
        );
    }

    const usuario =
        findUserByEmail(emailNormalizado);

    if (!usuario) {
        // No revelar si el email existe o no (security best practice)
        return {
            message: "Si el email existe en el sistema, recibirás un enlace de recuperación",
            email: emailNormalizado,
            expiresInMinutes: TOKEN_EXPIRATION_MINUTES
        };
    }

    const recoveryToken = crypto
        .randomBytes(TOKEN_LENGTH)
        .toString("hex");

    const expiresAtMs =
        Date.now() +
        TOKEN_EXPIRATION_MINUTES * 60 * 1000;

    createPasswordRecoveryToken(
        usuario.id,
        recoveryToken,
        expiresAtMs
    );

    // En producción, esto enviaría un email
    // con el token de recuperación
    console.log(
        `Recovery token for ${emailNormalizado}: ${recoveryToken} (expires in ${TOKEN_EXPIRATION_MINUTES} minutes)`
    );

    return {
        message: "Si el email existe en el sistema, recibirás un enlace de recuperación",
        email: emailNormalizado,
        expiresInMinutes: TOKEN_EXPIRATION_MINUTES
    };
}

interface ResetPasswordInput {
    token: unknown;
    newPassword: unknown;
}

/**
 * RF-1.4: Recuperación y Permiso
 * Resetea la contraseña usando un token de recuperación válido
 */
export async function resetPassword(
    input: ResetPasswordInput
) {
    const { token, newPassword } = input;

    if (
        typeof token !== "string" ||
        typeof newPassword !== "string"
    ) {
        throw new AuthError(
            400,
            "Token y contraseña nueva son obligatorios"
        );
    }

    if (newPassword.length < 6) {
        throw new AuthError(
            400,
            "La contraseña debe tener al menos 6 caracteres"
        );
    }

    const recoveryToken =
        findRecoveryTokenByToken(token);

    if (!recoveryToken) {
        throw new AuthError(
            401,
            "Token de recuperación inválido o expirado"
        );
    }

    // Verificar que el token no ha expirado
    const expiresAt = new Date(
        recoveryToken.expires_at
    );

    if (expiresAt < new Date()) {
        throw new AuthError(
            401,
            "Token de recuperación expirado"
        );
    }

    // Verificar que el token no ha sido usado
    if (recoveryToken.used) {
        throw new AuthError(
            401,
            "Token de recuperación ya fue utilizado"
        );
    }

    const usuario = findUserById(
        recoveryToken.usuario_id
    );

    if (!usuario) {
        throw new AuthError(
            500,
            "Error al procesar recuperación"
        );
    }

    // Hashear la nueva contraseña
    const newPasswordHash = await bcrypt.hash(
        newPassword,
        10
    );

    // Actualizar contraseña
    updateUserPassword(
        usuario.id,
        newPasswordHash
    );

    // Marcar token como usado
    markRecoveryTokenAsUsed(recoveryToken.id);

    return {
        message: "Contraseña actualizada exitosamente",
        email: usuario.email
    };
}
