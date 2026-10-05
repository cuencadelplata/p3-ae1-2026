import { findUserById } from "../repositories/user.repository";
import { AuthError } from "./auth.service";

// Datos que M1 comparte con el propio usuario y con los módulos que lo consultan con su token.
// Nunca se devuelve el hash de la contraseña.
export interface PerfilPropio {
    userId: number;
    nombre: string;
    apellido: string;
    dni: string;
    telefono: string;
    email: string;
    rol: string;
    estado: string;
    creadoEn: string;
}

export function obtenerPerfilPropio(userId: number): PerfilPropio {
    const usuario = findUserById(userId);

    // El token puede seguir vigente aunque el usuario ya no exista.
    if (!usuario) {
        throw new AuthError(404, "Usuario no encontrado");
    }

    // Un usuario bloqueado no puede consultar sus datos aunque su token no haya vencido.
    if (usuario.estado === "BLOQUEADO") {
        throw new AuthError(403, "Usuario bloqueado");
    }

    return {
        userId: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        dni: usuario.dni,
        telefono: usuario.telefono,
        email: usuario.email,
        rol: usuario.rol,
        estado: usuario.estado,
        creadoEn: usuario.created_at
    };
}
