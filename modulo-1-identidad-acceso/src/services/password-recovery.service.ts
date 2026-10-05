import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
    findUserByEmail,
    findUserById,
    updateUserPassword
} from "../repositories/user.repository";
import {
    TTL_TOKEN_SEGUNDOS,
    consumirTokenDeRecuperacion,
    guardarTokenDeRecuperacion,
    verificarConexion
} from "../repositories/recovery-token.repository";
import { publicarRecuperacionSolicitada } from "../messaging/recovery.publisher";
import { revocarCredenciales } from "./credential-revocation.service";
import { AuthError } from "./auth.service";

const TOKEN_EXPIRATION_MINUTES = Math.round(
    TTL_TOKEN_SEGUNDOS / 60
);
const TOKEN_LENGTH = 32;
const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

const MENSAJE_SOLICITUD =
    "Si el email existe en el sistema, recibirás un enlace de recuperación";

function servicioNoDisponible(): AuthError {
    return new AuthError(
        503,
        "La recuperación no está disponible en este momento. Intentá de nuevo más tarde"
    );
}

/**
 * RF-1.4: Recuperación y revocación
 * Genera un token temporal, lo guarda en Redis con vencimiento y publica un
 * evento en RabbitMQ para que el servicio de notificaciones envíe el correo.
 */
export async function requestPasswordRecovery(
    email: string
): Promise<{
    message: string;
    email: string;
    expiresInMinutes: number;
}> {
    const emailNormalizado = email
        .trim()
        .toLowerCase();

    if (!emailNormalizado.includes("@")) {
        throw new AuthError(
            400,
            "Email inválido"
        );
    }

    const respuesta = {
        message: MENSAJE_SOLICITUD,
        email: emailNormalizado,
        expiresInMinutes: TOKEN_EXPIRATION_MINUTES
    };

    // Se revisa Redis antes de buscar al usuario: si está caído, la respuesta es
    // 503 para cualquier email y no se puede deducir cuáles están registrados.
    try {
        await verificarConexion();
    } catch {
        throw servicioNoDisponible();
    }

    const usuario =
        findUserByEmail(emailNormalizado);

    if (!usuario) {
        // No revelar si el email existe o no
        return respuesta;
    }

    const recoveryToken = crypto
        .randomBytes(TOKEN_LENGTH)
        .toString("hex");

    try {
        await guardarTokenDeRecuperacion(
            usuario.id,
            recoveryToken
        );
    } catch {
        throw servicioNoDisponible();
    }

    // Parte asincrónica: se publica el evento y se responde sin esperar a que
    // el correo se envíe. Si falla, el token queda sin usar y vence solo.
    publicarRecuperacionSolicitada(
        usuario.id,
        usuario.email,
        usuario.nombre,
        recoveryToken,
        TTL_TOKEN_SEGUNDOS
    ).catch((error) => {
        console.error(
            "[RabbitMQ] No se pudo publicar la solicitud de recuperación:",
            error.message
        );
    });

    return respuesta;
}

interface ResetPasswordInput {
    token: unknown;
    newPassword: unknown;
}

/**
 * RF-1.4: Recuperación y revocación
 * Cambia la contraseña con un token válido. El token se consume (no se puede
 * volver a usar) y se revocan las sesiones que el usuario tenía abiertas.
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

    if (!FORMATO_TOKEN.test(token)) {
        throw new AuthError(
            401,
            "Token de recuperación inválido o expirado"
        );
    }

    let usuarioId: number | null;

    try {
        usuarioId = await consumirTokenDeRecuperacion(token);
    } catch {
        throw servicioNoDisponible();
    }

    // Si no está en Redis es porque nunca existió, ya se usó o pasaron los 15 minutos.
    if (usuarioId === null) {
        throw new AuthError(
            401,
            "Token de recuperación inválido o expirado"
        );
    }

    const usuario = findUserById(usuarioId);

    if (!usuario) {
        throw new AuthError(
            500,
            "Error al procesar recuperación"
        );
    }

    const newPasswordHash = await bcrypt.hash(
        newPassword,
        10
    );

    updateUserPassword(
        usuario.id,
        newPasswordHash
    );

    // Los JWT emitidos con la contraseña anterior dejan de valer.
    try {
        await revocarCredenciales(
            usuario.id,
            "CAMBIO_DE_CONTRASENA"
        );
    } catch (error) {
        console.error(
            "[Revocación] No se pudieron revocar las sesiones anteriores:",
            (error as Error).message
        );
    }

    return {
        message: "Contraseña actualizada exitosamente",
        email: usuario.email
    };
}
