import {
    CampoCompletable,
    completarDatosDeUsuario,
    findUserByDni,
    findUserById
} from "../repositories/user.repository";
import { AuthError } from "./auth.service";

const CAMPOS_COMPLETABLES: CampoCompletable[] = ["nombre", "apellido", "dni", "telefono"];

const NOMBRES_DE_CAMPO: Record<CampoCompletable, string> = {
    nombre: "nombre",
    apellido: "apellido",
    dni: "DNI",
    telefono: "teléfono"
};

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

// PATCH /auth/me: completa los datos que faltan.
//
// Quien entra con Google o Auth0 (RF-1.5) queda registrado sin DNI ni teléfono, porque esos
// proveedores no los informan. La interfaz lo manda a la pantalla de registro para que los
// complete una sola vez, con las mismas reglas del registro (RF-1.1). Un dato ya cargado no
// se puede cambiar: esto no es una edición de perfil.
export function completarDatosPropios(
    userId: number,
    datos: unknown
): PerfilPropio {
    const usuario = findUserById(userId);

    if (!usuario) {
        throw new AuthError(404, "Usuario no encontrado");
    }

    if (usuario.estado === "BLOQUEADO") {
        throw new AuthError(403, "Usuario bloqueado");
    }

    if (typeof datos !== "object" || datos === null || Array.isArray(datos)) {
        throw new AuthError(400, "El cuerpo del pedido debe ser un objeto JSON");
    }

    const recibidos = datos as Record<string, unknown>;
    const camposAjenos = Object.keys(recibidos).filter(
        (campo) => !CAMPOS_COMPLETABLES.includes(campo as CampoCompletable)
    );

    if (camposAjenos.length > 0) {
        throw new AuthError(
            400,
            `Solo se pueden completar nombre, apellido, DNI y teléfono (no se acepta: ${camposAjenos.join(", ")})`
        );
    }

    const cambios: Partial<Record<CampoCompletable, string>> = {};
    const errores: string[] = [];

    for (const campo of CAMPOS_COMPLETABLES) {
        const valor = recibidos[campo];

        if (valor === undefined) {
            continue;
        }

        const texto = typeof valor === "string" ? valor.trim() : "";

        if (!texto) {
            errores.push(`El ${NOMBRES_DE_CAMPO[campo]} no puede estar vacío.`);
            continue;
        }

        if (campo === "dni" && !/^\d{7,9}$/.test(texto)) {
            errores.push("El DNI debe contener entre 7 y 9 números.");
            continue;
        }

        if (usuario[campo].trim() !== "") {
            throw new AuthError(
                409,
                `El ${NOMBRES_DE_CAMPO[campo]} ya está cargado y no se puede modificar`
            );
        }

        cambios[campo] = texto;
    }

    if (errores.length > 0) {
        throw new AuthError(400, errores.join(" "));
    }

    if (Object.keys(cambios).length === 0) {
        throw new AuthError(400, "Indicá al menos un dato para completar");
    }

    if (cambios.dni) {
        const otroUsuario = findUserByDni(cambios.dni);

        if (otroUsuario && otroUsuario.id !== userId) {
            throw new AuthError(409, "Ya existe un usuario con ese DNI");
        }
    }

    if (!completarDatosDeUsuario(userId, cambios)) {
        throw new AuthError(409, "Alguno de los datos ya fue cargado. Recargá la página e intentá de nuevo");
    }

    return obtenerPerfilPropio(userId);
}
