import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";

// RF-1.3: usuario OPERADOR semilla para pruebas e integración entre módulos.
// El registro público sigue rechazando OPERADOR (400).
//
// Variables:
//   M1_OPERADOR_EMAIL     email del operador (por defecto operador@movilidad.com)
//   M1_OPERADOR_PASSWORD  contraseña. Si está definida, se aplica también a un operador
//                         que ya existía: al reiniciar M1 la contraseña queda sincronizada.
//                         Si no está definida:
//                           - en desarrollo se crea con OPERADOR_PASSWORD_DESARROLLO;
//                           - en producción NO se crea (una contraseña conocida no sirve ahí).

export const OPERADOR_EMAIL_POR_DEFECTO = "operador@movilidad.com";
export const OPERADOR_PASSWORD_DESARROLLO = "operador123";

export type ResultadoOperadorSemilla =
    | "creado"
    | "contrasena_actualizada"
    | "sin_cambios"
    | "omitido";

interface UsuarioExistente {
    id: number;
    rol: string;
    password_hash: string;
}

function crearOperador(
    db: Database.Database,
    email: string,
    password: string
): void {
    db.prepare(`
        INSERT OR IGNORE INTO usuarios (nombre, apellido, dni, telefono, email, password_hash, rol, estado)
        VALUES ('Operador', 'Sistema', '00000001', '0000000000', ?, ?, 'OPERADOR', 'ACTIVO')
    `).run(email, bcrypt.hashSync(password, 10));
}

export function asegurarOperadorSemilla(
    db: Database.Database,
    entorno: NodeJS.ProcessEnv = process.env
): ResultadoOperadorSemilla {
    const email = (entorno.M1_OPERADOR_EMAIL || OPERADOR_EMAIL_POR_DEFECTO)
        .trim()
        .toLowerCase();
    const passwordConfigurada = entorno.M1_OPERADOR_PASSWORD?.trim()
        ? entorno.M1_OPERADOR_PASSWORD
        : undefined;
    const esProduccion = entorno.NODE_ENV === "production";

    const existente = db
        .prepare("SELECT id, rol, password_hash FROM usuarios WHERE email = ?")
        .get(email) as UsuarioExistente | undefined;

    if (!passwordConfigurada) {
        if (esProduccion) {
            if (existente && bcrypt.compareSync(OPERADOR_PASSWORD_DESARROLLO, existente.password_hash)) {
                console.warn(
                    `[Operador semilla] ${email} todavía tiene la contraseña de desarrollo. ` +
                    "Definí M1_OPERADOR_PASSWORD para cambiarla."
                );
            } else if (!existente) {
                console.warn(
                    "[Operador semilla] No se crea: en producción hace falta M1_OPERADOR_PASSWORD."
                );
            }
            return existente ? "sin_cambios" : "omitido";
        }

        if (existente) {
            return "sin_cambios";
        }

        crearOperador(db, email, OPERADOR_PASSWORD_DESARROLLO);
        console.warn(
            `[Operador semilla] ${email} creado con la contraseña de desarrollo. ` +
            "Definí M1_OPERADOR_PASSWORD para usar otra."
        );
        return "creado";
    }

    if (!existente) {
        crearOperador(db, email, passwordConfigurada);
        return "creado";
    }

    // Nunca se le da rol OPERADOR a una cuenta que ya existía con otro rol.
    if (existente.rol !== "OPERADOR") {
        console.warn(
            `[Operador semilla] ${email} ya está registrado con rol ${existente.rol}: no se modifica.`
        );
        return "omitido";
    }

    if (bcrypt.compareSync(passwordConfigurada, existente.password_hash)) {
        return "sin_cambios";
    }

    db.prepare("UPDATE usuarios SET password_hash = ? WHERE id = ?")
        .run(bcrypt.hashSync(passwordConfigurada, 10), existente.id);
    console.warn(
        `[Operador semilla] Contraseña de ${email} actualizada desde M1_OPERADOR_PASSWORD.`
    );
    return "contrasena_actualizada";
}
